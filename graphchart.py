# -*- coding: utf-8 -*-
import wx
import math
import time
import astrology
import chart, houses, planets, fortune
import fixstars
import fixedstar_natures
import options
import common
import util
import mtexts
import arabicparts
import fortune
import mtexts
import hours
import datetime
import profections
import lordofyear
import radixsignals
import interchartaspects
import primdirs
import wxcompat
import types
import weakref
from collections.abc import Mapping
from aries.ui import tokens as _tokens

_MIDPOINT_RING_LAYOUT_CACHE = weakref.WeakKeyDictionary()

class GraphChart:

	DEG1 = math.pi/180
	DEG5 = math.pi/36
	DEG10 = math.pi/18
	DEG30 = math.pi/6

	SMALL_SIZE = 400
	MEDIUM_SIZE = 600
	PLANET_GLYPH_SCALE = 1.0
	DEGREE_TEXT_SCALE = 1.0
	INFO_LABEL_SCALE = 1.0
	PLANET_COLLISION_PAD = 2.0
	# Larger pad for inner deg/min position labels at rPosDeg/rPosMin — they
	# sit at small radii so the same pixel pad converts to a wider angle.
	# Drives _position_label_half_deg only; glyph collision still uses
	# PLANET_COLLISION_PAD so the glyph row stays legacy-tight.
	PLANET_LABEL_COLLISION_PAD = 5.0
	PLANET_DETAIL_SPACING_PASSES = 4
	OUTER_LABEL_EDGE_PAD_FACTOR = 0.15

	# Overlay info block tuning
	OVERLAY_ROW_HEIGHT_FACTOR = 0.94   # line_h = max(icon,text) * this
	OVERLAY_GAP_AFTER_DAYHOUR = 0.30   # gap below Day/Hour (multiplier of line_h)
	OVERLAY_GAP_BETWEEN_GROUPS = 0.30  # gap between groups (multiplier of line_h)
	OVERLAY_ICON_SCALE = 0.83          # icon glyph size multiplier
	OVERLAY_LABEL_SCALE = 1.08         # label text size multiplier
	OVERLAY_GAP_LABEL_GLYPH = 0.19     # label–glyph gap (multiplier of symbolSize)
	OVERLAY_GAP_GLYPH_GLYPH = 0.00     # glyph–glyph gap (multiplier of symbolSize)
	OVERLAY_GAP_GLYPH_OFFSET = 0.00    # glyph–offset gap (multiplier of symbolSize)

	THEME_CLASSIC = 0
	THEME_COMPACT = 1

	def __init__(self, chrt, size, opts, bw, planetaryday=True, chrt2 = None, theme=None, visual_style=None):
		self.chart = chrt
		self.chart2 = chrt2
		self.w, self.h = size
		# Some windows call the renderer before layout settles; prevent zero/negative
		# sizes from producing 0-sized bitmaps or 0 font sizes.
		try:
			self.w = max(1, int(self.w))
			self.h = max(1, int(self.h))
		except Exception:
			self.w = max(1, int(getattr(self.w, "x", 1)))
			self.h = max(1, int(getattr(self.h, "y", 1)))
		self.options = opts
		self.theme = theme if theme is not None else getattr(opts, 'theme', self.THEME_CLASSIC)
		# Export-only visual profile seam. Values are multipliers against the
		# established GraphChart defaults, produced from explicit, daemon-
		# validated style-profile overrides. Ordinary wx callers pass nothing;
		# Anglo is deliberately excluded because this renderer has no Anglo
		# grammar and must not masquerade as the web wheel's implementation.
		self._visual_style = visual_style if isinstance(visual_style, Mapping) else {}
		self._visual_style_enabled = self.theme in (self.THEME_CLASSIC, self.THEME_COMPACT)
		self.comparison_whole_sign = bool(self.chart2 is not None and getattr(self.options, "hsys", "P") == 'N')
		self.click_planet = None  # (chart_role, planet_index) or None, for exclusive-aspects-on-click mode
		self.show_houses = bool(getattr(self.options, "houses", False) and (getattr(self.options, "hsys", "P") != 'N' or self.comparison_whole_sign))
		self.bw = bw
		self.planetaryday = planetaryday
		# Legacy aesthetic: bitmap renders at logical 1× so a 1-px pen is
		# truly 1 source pixel (becomes ~2 physical px after the host's
		# bilinear upscale to Retina — matches Wine 96 DPI + macOS upscale).
		# Fonts / symbols use the REAL Retina DPI via `self._font_dpi_scale`
		# so glyph point sizes are still Retina-correct in the source; the
		# host's bilinear upscale then keeps them at proper visual size on
		# screen. Earlier draft forced both to 1× and got tiny symbols
		# because `_fs(v) = v * self._dpi_scale` collapsed font sizes too.
		_legacy = bool(getattr(opts, 'legacypixelated', False))
		_real_dpi = wxcompat.get_dpi_scale()
		self._dpi_scale = 1.0 if _legacy else _real_dpi
		self._font_dpi_scale = _real_dpi  # always Retina-correct for fonts
		self.buffer = wxcompat.create_scaled_bitmap(self.w, self.h, self._dpi_scale)
		self.bdc = wxcompat.CompatDC(wx.BufferedDC(None, self.buffer), self._dpi_scale, antialias=not _legacy)
		self.chartsize = min(self.w, self.h)
		self.maxradius = self.chartsize/2
		# wx.Point requires integer coordinates on wxPython (macOS is strict).
		self.center = wx.Point(int(self.w // 2), int(self.h // 2))
		self.hover_regions = []
		# Free-floating corner labels: instead of painting date/place/hsys/LOY
		# onto the wheel bitmap (which constrains them to the bitmap's
		# bounding square), the corner-text drawers append items here and the
		# host paints them in panel space — so they can drift into the
		# gutters when the panel is wider than the wheel's square.
		# Each item: {anchor, dx, dy, text, wx_font, color}.
		self.overlay_labels = []

		# Compact theme: dynamic offset that adjusts house ring based on enabled options
		self._baseoffset = 0.0
		if self.theme == self.THEME_COMPACT:
			val = 0
			if self.options.showdecans:
				val += 1
			if self.options.showterms:
				val += 1
			if (self.planetaryday and self.options.showfixstars != options.Options.NONE) or self.chart2 != None:
				val += 1
			if self.options.positions:
				if val == 1:
					self._baseoffset = self.maxradius*0.02
				elif val == 2:
					self._baseoffset = self.maxradius*0.08
				elif val == 3:
					self._baseoffset = self.maxradius*0.12
			elif val == 3:
				self._baseoffset = self.maxradius*0.05

		self.arrowlen = 0.04
		self.deg01510len = 0.01
		self.retrdiff = 0.01
		if self.chart2 == None:
			#if self.planetaryday and self.options.showfixstars != options.Options.NONE: #If planetaryday is True => radix chart
			if self.options.showfixstars != options.Options.NONE:
				self.symbolSize = self.maxradius/16
				self.signSize = self.maxradius/20
				self.planetsectorlen = 0.15
				self.signsectorlen = self.planetsectorlen
				self.signoffs = (self.signsectorlen/2.0)*self.maxradius
				self.planetoffs = (self.planetsectorlen/2.0)*self.maxradius
				self.planetlinelen = 0.03
				self.rHousesectorlen = 0.06
				self.rAntis = self.maxradius*0.90
				self.rAntisLines = self.maxradius*0.86
				self.rFixstars = self.maxradius*0.88#84
				self.r30 = self.maxradius*0.83

				self.rOuterLine = self.maxradius*0.86
				self.rOuter0 = self.r30
				self.rOuter1 = self.rOuter0-self.deg01510len*self.maxradius
				self.rOuter5 = self.rOuter1-self.deg01510len*self.maxradius
				self.rOuter10 = self.rOuter5-self.deg01510len*self.maxradius
				self.rOuterMin = self.maxradius*0.82
				self.rSign = self.r30-self.signoffs
				self.r0 = self.r30-self.signsectorlen*self.maxradius
				self.r1 = self.r0+self.deg01510len*self.maxradius
				self.r5 = self.r1+self.deg01510len*self.maxradius
				self.r10 = self.r5+self.deg01510len*self.maxradius
				self.rASCMC = self.rSign
				self.rArrow = self.rASCMC+self.arrowlen*self.maxradius

				self.rTerms = self.r0
				self.termssectorlen = 0.0
				if self.options.showterms:
					self.termssectorlen = 0.08
				self.termsoffs = (self.termssectorlen/2.0)*self.maxradius
				self.rTermsPlanet = self.r0-self.termsoffs#
				self.rDecans = self.rTerms-self.termssectorlen*self.maxradius
				self.decanssectorlen = 0.0
				if self.options.showdecans:
					self.decanssectorlen = 0.08
				self.decansoffs = (self.decanssectorlen/2.0)*self.maxradius
				self.rInner = self.rDecans-self.decanssectorlen*self.maxradius
				self.rDecansPlanet = self.rInner+self.decansoffs#

				self.rLLine = self.rInner-self.planetlinelen*self.maxradius #line between zodiacpos & planet
				self.rPlanet = self.rInner-self.planetoffs
				if self.theme == self.THEME_CLASSIC:
					self.rAsp = self.rInner-self.planetsectorlen*self.maxradius
					self.rLLine2 = self.rAsp+self.planetlinelen*self.maxradius
					self.rRetr = self.rLLine2+self.maxradius*self.retrdiff

					pos = 0.48
					aspascmc = 0.43
					posascmc = 0.41
					poshouses = 0.32
					if self.options.showdecans and self.options.showterms:
						pos = 0.32
						aspascmc = 0.28
						posascmc = 0.27
						poshouses = 0.21
					elif self.options.showdecans or self.options.showterms:
						pos = 0.40
						aspascmc = 0.36
						posascmc = 0.34
						poshouses = 0.25

					self.rPos = self.maxradius*pos
					self.rAspAscMC = self.maxradius*aspascmc
					self.rPosAscMC = self.maxradius*posascmc
					self.rPosHouses = self.maxradius*poshouses
					self.rBase = self.maxradius*0.11
					self.rHouse = self.rBase+self.rHousesectorlen*self.maxradius
					self.rHouseName = self.maxradius*0.14
				else:
					self.rPosDeg = self.rInner-self.planetsectorlen*self.maxradius
					self.rPosMin = self.rPosDeg-0.04*self.maxradius
					self.rRetr = self.rPosMin-0.05*self.maxradius

					posascmc = 0.36
					poshouses = 0.36
					if self.options.showdecans and self.options.showterms:
						posascmc = 0.24
						poshouses = 0.24
					elif self.options.showdecans or self.options.showterms:
						posascmc = 0.30
						poshouses = 0.30

					self.rPosAscMC = self.maxradius*posascmc
					self.rPosAscMCMin = self.rPosAscMC-self.maxradius*0.05
					self.rPosHouses = self.maxradius*poshouses
					self.rPosHousesMin = self.rPosHouses-self.maxradius*0.05
					self.rBase = self.maxradius*0.24-self._baseoffset
					self.rHouse = self.rBase+self.rHousesectorlen*self.maxradius
					self.rHouseName = self.maxradius*0.27-self._baseoffset
			else:
				self.symbolSize = self.maxradius/16
				self.signSize = self.maxradius/20
				self.signsectorlen = 0.15
				self.planetsectorlen = 0.15
				self.planetoffs = (self.planetsectorlen/2.0)*self.maxradius
				self.planetlinelen = 0.03
				self.rHousesectorlen = 0.06
				self.r30 = self.maxradius*0.83
				self.signoffs = (self.signsectorlen/2.0)*self.maxradius
				self.rSign = self.r30-self.signoffs
				self.rASCMC = self.rSign
				self.rArrow = self.rASCMC+self.arrowlen*self.maxradius
				self.r0 = self.r30-self.signsectorlen*self.maxradius
				self.r1 = self.r0+self.deg01510len*self.maxradius
				self.r5 = self.r1+self.deg01510len*self.maxradius
				self.r10 = self.r5+self.deg01510len*self.maxradius

				self.rTerms = self.r0
				self.termssectorlen = 0.0
				if self.options.showterms:
					self.termssectorlen = 0.08
				self.termsoffs = (self.termssectorlen/2.0)*self.maxradius
				self.rTermsPlanet = self.r0-self.termsoffs#
				self.rDecans = self.rTerms-self.termssectorlen*self.maxradius
				self.decanssectorlen = 0.0
				if self.options.showdecans:
					self.decanssectorlen = 0.08
				self.decansoffs = (self.decanssectorlen/2.0)*self.maxradius
				self.rInner = self.rDecans-self.decanssectorlen*self.maxradius
				self.rDecansPlanet = self.rInner+self.decansoffs#

				self.rLLine = self.rInner-self.planetlinelen*self.maxradius #line between zodiacpos & planet
				self.rPlanet = self.rInner-self.planetoffs
				if self.theme == self.THEME_CLASSIC:
					self.rAsp = self.rInner-self.planetsectorlen*self.maxradius
					self.rLLine2 = self.rAsp+self.planetlinelen*self.maxradius
					self.rRetr = self.rLLine2+self.maxradius*self.retrdiff

					pos = 0.48
					aspascmc = 0.43
					posascmc = 0.41
					poshouses = 0.32
					if self.options.showdecans and self.options.showterms:
						pos = 0.32
						aspascmc = 0.28
						posascmc = 0.27
						poshouses = 0.21
					elif self.options.showdecans or self.options.showterms:
						pos = 0.40
						aspascmc = 0.36
						posascmc = 0.34
						poshouses = 0.25

					self.rPos = self.maxradius*pos
					self.rAspAscMC = self.maxradius*aspascmc
					self.rPosAscMC = self.maxradius*posascmc
					self.rPosHouses = self.maxradius*poshouses
					self.rBase = self.maxradius*0.11
					self.rHouse = self.rBase+self.rHousesectorlen*self.maxradius
					self.rHouseName = self.maxradius*0.14
				else:
					self.rPosDeg = self.rInner-self.planetsectorlen*self.maxradius
					self.rPosMin = self.rPosDeg-0.05*self.maxradius
					self.rRetr = self.rPosMin-0.05*self.maxradius

					posascmc = 0.36
					poshouses = 0.36
					if self.options.showdecans and self.options.showterms:
						posascmc = 0.24
						poshouses = 0.24
					elif self.options.showdecans or self.options.showterms:
						posascmc = 0.30
						poshouses = 0.30

					self.rPosAscMC = self.maxradius*posascmc
					self.rPosAscMCMin = self.rPosAscMC-self.maxradius*0.05
					self.rPosHouses = self.maxradius*poshouses
					self.rPosHousesMin = self.rPosHouses-self.maxradius*0.05
					self.rBase = self.maxradius*0.24-self._baseoffset
					self.rHouse = self.rBase+self.rHousesectorlen*self.maxradius
					self.rHouseName = self.maxradius*0.27-self._baseoffset
		else:
			self.symbolSize = self.maxradius/16
			self.signSize = self.maxradius/20
			self.outerplanetsectorlen = 0.12
			self.planetsectorlen = 0.15
			self.signsectorlen = self.planetsectorlen
			self.signoffs = (self.signsectorlen/2.0)*self.maxradius
			self.planetoffs = (self.planetsectorlen/2.0)*self.maxradius
			self.planetlinelen = 0.03
			self.rHousesectorlen = 0.06
			self.rOuterMax = self.maxradius*0.97
			if self.show_houses:
				self.rOuterHouseName = self.rOuterMax-(self.rHousesectorlen*self.maxradius)/2.0
				self.rOuterHouse = self.rOuterMax-self.rHousesectorlen*self.maxradius
				self.r30 = self.rOuterHouse-self.outerplanetsectorlen*self.maxradius
			else:
				self.r30 = self.rOuterMax-self.outerplanetsectorlen*self.maxradius
				self.rOuterASCMC = self.maxradius*0.92

			self.rOuterPlanet = self.r30+self.planetoffs
			self.rOuterASCMC = self.maxradius*0.92
			self.rOuterArrow = self.rOuterASCMC+self.arrowlen*self.maxradius
			self.rOuterLine = self.r30+self.planetlinelen*self.maxradius
			self.rOuterRetr = self.rOuterLine+self.maxradius*self.retrdiff
			self.rOuter0 = self.r30
			self.rOuter1 = self.rOuter0-self.deg01510len*self.maxradius
			self.rOuter5 = self.rOuter1-self.deg01510len*self.maxradius
			self.rOuter10 = self.rOuter5-self.deg01510len*self.maxradius
			self.rOuterMin = self.maxradius*0.78
			self.rSign = self.r30-self.signoffs
			self.r0 = self.r30-self.signsectorlen*self.maxradius
			self.r1 = self.r0+self.deg01510len*self.maxradius
			self.r5 = self.r1+self.deg01510len*self.maxradius
			self.r10 = self.r5+self.deg01510len*self.maxradius
			self.rASCMC = self.rSign
			self.rArrow = self.rASCMC+self.arrowlen*self.maxradius

			self.rTerms = self.r0
			self.termssectorlen = 0.0
			if self.options.showterms:
				self.termssectorlen = 0.08
			self.termsoffs = (self.termssectorlen/2.0)*self.maxradius
			self.rTermsPlanet = self.r0-self.termsoffs#
			self.rDecans = self.rTerms-self.termssectorlen*self.maxradius
			self.decanssectorlen = 0.0
			if self.options.showdecans:
				self.decanssectorlen = 0.08
			self.decansoffs = (self.decanssectorlen/2.0)*self.maxradius
			self.rInner = self.rDecans-self.decanssectorlen*self.maxradius
			self.rDecansPlanet = self.rInner+self.decansoffs#

			self.rLLine = self.rInner-self.planetlinelen*self.maxradius #line between zodiacpos & planet
			self.rPlanet = self.rInner-self.planetoffs
			if self.theme == self.THEME_CLASSIC:
				self.rAsp = self.rInner-self.planetsectorlen*self.maxradius
				self.rLLine2 = self.rAsp+self.planetlinelen*self.maxradius
				self.rRetr = self.rLLine2+self.maxradius*self.retrdiff

				pos = 0.45
				aspascmc = 0.41
				posascmc = 0.41
				poshouses = 0.32
				if self.options.showdecans and self.options.showterms:
					pos = 0.30
					aspascmc = 0.25
					posascmc = 0.25
					poshouses = 0.20
				elif self.options.showdecans or self.options.showterms:
					pos = 0.37
					aspascmc = 0.32
					posascmc = 0.32
					poshouses = 0.24

				self.rPos = self.maxradius*pos
				self.rAspAscMC = self.maxradius*aspascmc
				self.rPosAscMC = self.maxradius*posascmc
				self.rPosHouses = self.maxradius*poshouses
				self.rBase = self.maxradius*0.11
				self.rHouse = self.rBase+self.rHousesectorlen*self.maxradius
				self.rHouseName = self.maxradius*0.14
			else:
				self.rPosDeg = self.rInner-self.planetsectorlen*self.maxradius
				self.rPosMin = self.rPosDeg-0.05*self.maxradius
				self.rRetr = self.rPosMin-0.05*self.maxradius

				posascmc = 0.34
				poshouses = 0.34
				if self.options.showdecans and self.options.showterms:
					posascmc = 0.20
					poshouses = 0.20
				elif self.options.showdecans or self.options.showterms:
					posascmc = 0.26
					poshouses = 0.26

				self.rPosAscMC = self.maxradius*posascmc
				self.rPosAscMCMin = self.rPosAscMC-self.maxradius*0.05
				self.rPosHouses = self.maxradius*poshouses
				self.rPosHousesMin = self.rPosHouses-self.maxradius*0.05
				self.rBase = self.maxradius*0.24-self._baseoffset
				self.rHouse = self.rBase+self.rHousesectorlen*self.maxradius
				self.rHouseName = self.maxradius*0.27-self._baseoffset

		profile = 'classic' if self.theme == self.THEME_CLASSIC else 'compact'
		self.symbolSize *= self._visual_factor('bodyScale')
		self.signSize *= self._visual_factor(profile + 'SignScale')
		# The web contract makes subdivision and outer sizes independent from
		# body size. Their native defaults are still maxradius/24 and /16, so a
		# multiplier of one preserves every historical GraphChart pixel.
		self.smallsymbolSize = (self.maxradius/24.0) * self._visual_factor(profile + 'SubdivisionScale')
		self.outerSymbolSize = (self.maxradius/16.0) * self._visual_factor(profile + 'OuterScale')
		if hasattr(self, 'rOuterRetr'):
			self.rOuterRetr = self.rOuterLine + self.outerSymbolSize * 0.16 * self._visual_factor('outerMotionRadiusScale')
		try:
			self.planetGlyphScale = max(0.5, float(getattr(self, 'PLANET_GLYPH_SCALE', 1.0)))
		except Exception:
			self.planetGlyphScale = 1.0
		try:
			self.degreeTextScale = max(0.5, float(getattr(self, 'DEGREE_TEXT_SCALE', 1.0)))
		except Exception:
			self.degreeTextScale = 1.0
		try:
			self.infoLabelScale = max(0.5, float(getattr(self, 'INFO_LABEL_SCALE', 1.0)))
		except Exception:
			self.infoLabelScale = 1.0
		self.planetGlyphSize = max(1.0, self.symbolSize * self.planetGlyphScale)
		self.outerPlanetGlyphSize = max(1.0, self.outerSymbolSize * self.planetGlyphScale)

		# Font sizes always use the REAL Retina DPI, even when the bitmap is
		# rendered at logical 1× (legacy aesthetic). Otherwise glyph point
		# sizes collapse to half on Retina and every symbol/label appears
		# tiny — see the legacy-pixelated mode in the constructor.
		_sc = getattr(self, '_font_dpi_scale', self._dpi_scale)
		def _fs(v):
			try:
				return max(1, int(v * _sc))
			except Exception:
				return 1

		self.fntMorinus = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, _fs(self.planetGlyphSize))
		self.fntOuterMorinus = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, _fs(self.outerPlanetGlyphSize))
		self.fntSmallMorinus = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, _fs(self.smallsymbolSize))
		self.fntMorinusSigns = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, _fs(self.signSize))
		self.aspectGlyphSize = self.symbolSize/2 * self._visual_factor('aspectGlyphScale')
		self.aspectGlyphOffset = self.symbolSize/4 * self._visual_factor('aspectGlyphOffsetScale')
		self.fntAspects = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, _fs(self.aspectGlyphSize))
		self.fntRetr = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, _fs(self.symbolSize/2))
		text_face = getattr(common.common, 'abc_face', 'FreeSans')
		# Septile glyph is a literal sans-serif 'S' — Morinus.ttf's 'S' slot is
		# occupied by the trine triangle. Bold weight gives the single letter
		# enough visual presence at the same size as the Morinus glyph strokes.
		text_bold_face = getattr(common.common, 'abc_bold_face', text_face)
		self.fntAspectsText = wxcompat.VectorFont(text_bold_face, _fs(self.aspectGlyphSize))
		self.fntText = wxcompat.VectorFont(text_face, _fs(self.outerSymbolSize/2 * self._visual_factor('outerLabelScale')))
		self.fntHouseText = wxcompat.VectorFont(text_face, _fs(self.symbolSize/2 * self._visual_factor('houseLabelScale')))
		self.fntOuterHouseText = wxcompat.VectorFont(text_face, _fs(self.outerSymbolSize/2 * self._visual_factor('houseLabelScale')))
		self.fntAntisText = wxcompat.VectorFont(text_face, _fs(self.symbolSize))
		self.fntDegreeText = wxcompat.VectorFont(text_face, _fs(self.symbolSize/2 * self.degreeTextScale * self._visual_factor('degreeScale')))
		self.fntInfoLabel = wxcompat.VectorFont(text_face, _fs(self.symbolSize * 0.38 * self.infoLabelScale))
		_overlay_icon_sc = max(0.5, float(getattr(self, 'OVERLAY_ICON_SCALE', 1.0)))
		_overlay_lbl_sc = max(0.5, float(getattr(self, 'OVERLAY_LABEL_SCALE', 1.0)))
		self.fntOverlayIcon = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, _fs(self.smallsymbolSize * _overlay_icon_sc))
		self.fntOverlayLabel = wxcompat.VectorFont(text_face, _fs(self.symbolSize * 0.38 * self.infoLabelScale * _overlay_lbl_sc))
		self.fntSmallText2 = wxcompat.VectorFont(text_face, _fs(self.symbolSize/3))
		if self.theme == self.THEME_CLASSIC:
			self.fntSmallText = wxcompat.VectorFont(text_face, _fs(self.symbolSize/4))
		else:
			self.fntSmallText = wxcompat.VectorFont(text_face, _fs(self.symbolSize/2))
		self.fntSmallTextOuter = wxcompat.VectorFont(text_face, _fs(self.symbolSize/4))
		minute_base = self.symbolSize/4 if self.theme == self.THEME_CLASSIC else self.symbolSize/3
		self.fntMinuteText = wxcompat.VectorFont(text_face, _fs(minute_base * self._visual_factor('minuteScale')))
		self.fntMotionClassic = wxcompat.VectorFont(text_face, _fs(self.symbolSize/4 * self._visual_factor('motionScale')))
		self.fntMotionCompact = wxcompat.VectorFont(text_face, _fs(self.symbolSize/2 * self._visual_factor('motionScale')))
		self.fntMotionStation = wxcompat.VectorFont(text_face, _fs(self.symbolSize/3 * self._visual_factor('motionScale')))
		self.fntMotionCompactRetr = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, _fs(self.symbolSize/2 * self._visual_factor('motionScale')))
		outer_motion_base = self.outerSymbolSize/3 if self.theme == self.THEME_CLASSIC else self.outerSymbolSize/4
		self.fntOuterMotion = wxcompat.VectorFont(text_face, _fs(outer_motion_base * self._visual_factor('motionScale')))
		self.fntOuterMotionStation = wxcompat.VectorFont(text_face, _fs(self.outerSymbolSize/3 * self._visual_factor('motionScale')))
		self.fntTinyText = wxcompat.VectorFont(text_face, _fs(self.symbolSize/5))
		self.fntBigText = wxcompat.VectorFont(text_face, _fs(self.symbolSize/4*3 * self.infoLabelScale))
		self.fntMorinus2 = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, _fs(self.symbolSize/4*3))
		self.deg_symbol = u'\u00b0'

		self.arsigndiff = (0, -1, -1, 2, -1, 3, 4, -1, -1, -1, 6)
		self.hsystem = {'P':mtexts.txts['HSPlacidus'], 'K':mtexts.txts['HSKoch'], 'R':mtexts.txts['HSRegiomontanus'], 'C':mtexts.txts['HSCampanus'], 'E':mtexts.txts['HSEqual'], 'W':mtexts.txts['HSWholeSign'], 'X':mtexts.txts['HSAxial'], 'M':mtexts.txts['HSMorinus'], 'H':mtexts.txts['HSHorizontal'], 'T':mtexts.txts['HSPagePolich'], 'B':mtexts.txts['HSAlcabitus'], 'O':mtexts.txts['HSPorphyrius'], 'N':mtexts.txts.get('HSNoHouses', 'Angles only')}

		# Keep this short-label map in lock-step with mtexts.ayanamshalist
		# and astrology._AYANAMSHA_SWE_MODE_BY_UI_INDEX — all three are
		# keyed by the same UI index.
		self.ayans = {
			0:  mtexts.txts['None'],
			1:  mtexts.txts['FaganBradley'],
			2:  mtexts.txts['Lahiri'],
			3:  mtexts.txts.get('TrueChitra', 'True Chitra'),
			4:  mtexts.txts['Krishnamurti'],
			5:  mtexts.txts['Raman'],
			6:  mtexts.txts['Yukteshwar'],
			7:  mtexts.txts['Deluce'],
			8:  mtexts.txts['JNBhasin'],
			9:  mtexts.txts['Ushashashi'],
			10: mtexts.txts['DjwhalKhul'],
			11: mtexts.txts['GalacticCenter0Sag2'],
			12: mtexts.txts.get('GalacticGilBrand2', 'Gil Brand'),
			13: mtexts.txts['Aldebaran15Tau2'],
			14: mtexts.txts['BabylonianKuglerI2'],
			15: mtexts.txts['BabylonianKuglerII2'],
			16: mtexts.txts['BabylonianKuglerIII2'],
			17: mtexts.txts['BabylonianHuber2'],
			18: mtexts.txts['BabylonianMercier2'],
			19: mtexts.txts['Hipparchos'],
			20: mtexts.txts['Sassanian'],
			21: mtexts.txts['J2000'],
			22: mtexts.txts['J1900'],
			23: mtexts.txts['B1950'],
		}

	def _visual_factor(self, key):
		if not self._visual_style_enabled:
			return 1.0
		try:
			value = float(self._visual_style.get(key, 1.0))
		except (TypeError, ValueError):
			return 1.0
		return value if math.isfinite(value) and value > 0.0 else 1.0

	def _visual_has(self, key):
		return self._visual_style_enabled and key in self._visual_style

	def _visual_pen_width(self, key, native_width):
		return max(1, int(round(float(native_width) * self._visual_factor(key))))

	def _hairline_width(self):
		return self._visual_pen_width('hairlineStroke', 1)

	def _medium_width(self):
		# Preserve GraphChart's native 1/2 px bucket at multiplier one. The web
		# token is translated relatively because Canvas uses continuous 720 px
		# reference scaling while the retained bitmap renderer does not.
		native = 1 if self.chartsize <= GraphChart.MEDIUM_SIZE else 2
		return self._visual_pen_width('mediumStrokeBase', native)

	def _degree_tick_width(self):
		key = 'degreeTickStrokeSmall' if self.chartsize <= GraphChart.MEDIUM_SIZE else 'degreeTickStrokeLarge'
		native = 1 if self.chartsize <= GraphChart.MEDIUM_SIZE else 2
		return self._visual_pen_width(key, native)

	def _ascmc_base_width(self):
		fallback = 5.0 * self._visual_factor('ascMcStrokeBase')
		if self._visual_has('ascMcStrokeBase'):
			return fallback
		try:
			return float(getattr(self.options, 'ascmcsize', fallback))
		except (TypeError, ValueError):
			return fallback

	def _outer_radius_offset(self):
		return self.outerSymbolSize * 0.2 * self._visual_factor('outerRadiusOffsetScale')

	def _outer_outside_pad(self):
		return int(self.outerSymbolSize * 0.10 * self._visual_factor('outerOutsidePadScale'))

	def _effective_hsys(self):
		if self.comparison_whole_sign:
			return 'W'
		return self.options.hsys

	def _rotation_anchor_chart(self):
		explicit_anchor = getattr(self, 'display_anchor_chart', None)
		if explicit_anchor is not None and getattr(explicit_anchor, 'houses', None) is not None:
			return explicit_anchor
		mode = int(getattr(self.options, 'quickcharts_anchor_to_radix', options.Options.QUICKCHARTS_ANCHOR_AUTO))
		radix = getattr(self, 'radix', None)
		if mode != options.Options.QUICKCHARTS_ANCHOR_AUTO:
			if radix is not None and radix is not self.chart and getattr(radix, 'houses', None) is not None:
				return radix
		return self.chart

	def _rotation_asc(self, sidereal=False):
		anchor_chart = self._rotation_anchor_chart()
		asc = anchor_chart.houses.ascmc[houses.Houses.ASC]
		if sidereal and self.options.ayanamsha != 0:
			asc = util.normalize(asc-anchor_chart.ayanamsha)
		return asc

	def _display_house_anchor(self):
		asc = self._rotation_asc()
		if self.options.ayanamsha != 0 and self._effective_hsys() == 'W':
			asc = util.normalize(asc-self._rotation_anchor_chart().ayanamsha)
		return asc

	def _display_house_cusp(self, chrt, index):
		if self._effective_hsys() == 'W':
			asc = chrt.houses.ascmc[houses.Houses.ASC]
			if self.options.ayanamsha != 0:
				asc = util.normalize(asc-chrt.ayanamsha)
			sign = int(asc/chart.Chart.SIGN_DEG)
			return util.normalize(sign*chart.Chart.SIGN_DEG + (index-1)*chart.Chart.SIGN_DEG)

		lon = chrt.houses.cusps[index]
		if self.options.ayanamsha != 0:
			lon = util.normalize(lon-chrt.ayanamsha)
		return lon

	def _hover_pad(self):
		return max(6, int(round(self.symbolSize * 0.35)))

	def _ring_stroke_width(self):
		"""Base stroke width (pre-size-scaling) for the chart's primary rings.

		Reads ``options.chartringthickness`` so the Appearance dialog slider
		retunes every ring stroke (r30, rInner, redraw, outer 30-deg lines)
		without per-callsite changes. Falls back to the token default.

		Legacy aesthetic: bucket the ring width by chart size, mirroring
		pre-fork Morinus's per-callsite `w = 3; if chartsize ≤ SMALL: w = 1;
		elif chartsize ≤ MEDIUM: w = 2` (graphchart.py:546-550 at 326b09b).
		Without this the ring stays at a flat width when the app window is
		shrunk, leaving it visually chunky relative to the smaller wheel —
		legacy chose thinner rings at smaller chart sizes for proportional
		weight. The top bucket stays at 2 (not 3) since at large chartsizes
		on Retina the bilinear macOS-upscale of a Wine bitmap reads ~2 px
		anyway — keeps parity with the user's Wine reference screenshots."""
		if bool(getattr(self.options, 'legacypixelated', False)):
			# Top bucket capped at 2 (not legacy's 3) since on Retina the
			# bilinear macOS-upscale of a Wine bitmap reads ~2 px anyway —
			# previous testing with 3 produced the "chunky" complaint.
			if self.chartsize <= GraphChart.SMALL_SIZE:
				return 1
			return 2
		minimum = _tokens.CHART_RING_THICKNESS_MIN * self._visual_factor('chartRingStrokeMin')
		maximum = _tokens.CHART_RING_THICKNESS_MAX * self._visual_factor('chartRingStrokeMax')
		fallback = _tokens.CHART_RING_THICKNESS * self._visual_factor('chartRingStrokeFallback')
		try:
			value = (
				fallback
				if self._visual_has('chartRingStrokeFallback')
				else float(getattr(self.options, 'chartringthickness', fallback))
			)
		except (TypeError, ValueError):
			value = fallback
		return max(minimum, min(maximum, value))

	def _scaled_line_w(self, requested, ref_size=720):
		"""Scale a desired pen width by current chart size so strokes stay
		**visually proportional** across sizes. ``requested`` is the width
		intended at the reference chart side (default 720 px). Replaces the
		former stepwise SMALL_SIZE / MEDIUM_SIZE buckets, which produced an
		abrupt thickening just below each threshold (e.g. 3 px at a 401-px
		chart reads ~50 % thicker than 4 px at a 720-px chart). Continuous
		scaling rounds to the nearest pixel and never returns less than 1.

		Legacy aesthetic: when ``options.legacypixelated`` is on, return
		``requested`` unscaled (no chartsize boost) — but apply the same
		stepwise downcap that pre-fork Morinus's `drawAscMC` did: at
		``chartsize ≤ SMALL_SIZE`` (400), pens of 3/4/5 are reduced to 2;
		at ``chartsize ≤ MEDIUM_SIZE`` (600), pens of 4/5 are reduced to 3;
		above 600 the literal stays. Without this cap, ``ascmcsize=5``
		comes through as a 5-logical-px pen = 10 physical px on Retina,
		which reads as a solid bar; legacy capped these pens specifically
		to keep AscMC arrowheads visually distinct from a filled triangle.
		Rings (`chartringthickness=2`) are unaffected by the cap so they
		stay at 2."""
		if bool(getattr(self.options, 'legacypixelated', False)):
			try:
				w = max(1, int(requested))
			except Exception:
				return 1
			if self.chartsize <= GraphChart.SMALL_SIZE and w in (3, 4, 5):
				return 2
			if self.chartsize <= GraphChart.MEDIUM_SIZE and w in (4, 5):
				return 3
			return w
		try:
			factor = float(self.chartsize) / float(ref_size)
		except Exception:
			return max(1, int(requested))
		return max(1, int(round(requested * factor)))

	def _angle_lon(self, chrt, index):
		houses_obj = getattr(chrt, 'houses', None)
		ascmc = getattr(houses_obj, 'ascmc', None)
		if ascmc is None:
			return None
		try:
			lon = float(ascmc[index])
		except (TypeError, ValueError, IndexError):
			return None
		if not math.isfinite(lon):
			return None
		return util.normalize(lon)

	def _register_hover_region(self, kind, object_id, left, top, width, height, chart_role='primary', priority=0, data=None):
		pad = self._hover_pad()
		self.hover_regions.append({
			'shape': 'rect',
			'kind': kind,
			'object_id': object_id,
			'chart_role': chart_role,
			'rect': (
				int(round(left - pad)),
				int(round(top - pad)),
				int(round(width + (pad * 2))),
				int(round(height + (pad * 2))),
			),
			'priority': int(priority),
			'data': dict(data or {}),
		})

	def _register_sector_hover_region(self, kind, object_id, cx, cy, inner_radius, outer_radius, start_angle, end_angle, chart_role='primary', priority=0, data=None):
		self.hover_regions.append({
			'shape': 'sector',
			'kind': kind,
			'object_id': object_id,
			'chart_role': chart_role,
			'sector': {
				'cx': float(cx),
				'cy': float(cy),
				'inner_radius': max(0.0, float(inner_radius)),
				'outer_radius': max(float(inner_radius), float(outer_radius)),
				'start_angle': util.normalize(float(start_angle)),
				'end_angle': util.normalize(float(end_angle)),
			},
			'priority': int(priority),
			'data': dict(data or {}),
		})

	def _register_line_hover_region(self, kind, object_id, x1, y1, x2, y2, tolerance, chart_role='primary', priority=0, data=None):
		self.hover_regions.append({
			'shape': 'line',
			'kind': kind,
			'object_id': object_id,
			'chart_role': chart_role,
			'line': {
				'x1': float(x1),
				'y1': float(y1),
				'x2': float(x2),
				'y2': float(y2),
				'tolerance': max(1.0, float(tolerance)),
			},
			'priority': int(priority),
			'data': dict(data or {}),
		})

	def _register_text_hover_region(self, kind, object_id, text, font, left, top, chart_role='primary', priority=0, data=None):
		width, height = self.draw.textsize(text, font)
		self._register_hover_region(kind, object_id, left, top, width, height, chart_role=chart_role, priority=priority, data=data)

	def _register_secondary_ring_text_hover(self, family, object_id, text, font, left, top, title, longitude, display_lon=None, chart_role='primary', priority=0, data=None):
		payload = {
			'family': family,
			'title': title,
			'longitude': longitude,
			'display_lon': longitude if display_lon is None else display_lon,
		}
		payload.update(data or {})
		self._register_text_hover_region('secondary_ring', object_id, text, font, left, top, chart_role=chart_role, priority=priority, data=payload)

	def _secondary_overlay_hover_family(self):
		if self.options.showfixstars == options.Options.DODECATEMORIA:
			return 'dodecatemoria', mtexts.txts.get('Dodecatemoria', 'Dodecatemoria')
		if self.options.showfixstars == options.Options.ANTIS:
			return 'antiscia', mtexts.txts.get('Antiscia', 'Antiscia')
		if self.options.showfixstars == options.Options.CANTIS:
			return 'contra_antiscia', mtexts.txts.get('ContraAntiscia', 'Contraantiscia')
		return 'secondary_ring', 'Secondary ring'

	def _register_centered_text_hover_region(self, kind, object_id, text, font, cx, cy, chart_role='primary', priority=0, data=None):
		width, height = self.draw.textsize(text, font)
		self._register_hover_region(
			kind, object_id,
			cx - (width / 2.0),
			cy - (height / 2.0),
			width, height,
			chart_role=chart_role,
			priority=priority,
			data=data,
		)

	def _register_empty_midband_click_region(self):
		if self.chart2 is not None or self.theme != self.THEME_CLASSIC:
			return
		if not hasattr(self, 'rAsp') or not hasattr(self, 'rInner'):
			return
		(cx, cy) = self.center.Get()
		pad = self._hover_pad()
		inner_radius = max(0.0, float(self.rAsp) - (pad * 0.5))
		outer_radius = max(inner_radius, float(self.rInner) + (pad * 0.5))
		self._register_sector_hover_region(
			'midband_empty',
			'midband_empty',
			cx,
			cy,
			inner_radius,
			outer_radius,
			0.0,
			359.999,
			priority=-10,
		)

	def _register_point_hover_region(self, kind, object_id, cx, cy, chart_role='primary', priority=0, data=None):
		pad = self._hover_pad()
		self._register_hover_region(kind, object_id, cx - pad, cy - pad, pad * 2, pad * 2, chart_role=chart_role, priority=priority, data=data)

	def _aspect_hover_data(self, asp, body_a=None, body_b=None):
		clr = (0, 0, 0)
		if not self.bw:
			clr = self.options.clraspect[asp.typ]
		data = {
			'aspect_type': asp.typ,
			'colour': clr,
			'orb': float(getattr(asp, 'aspdif', 0.0)),
			'exact': bool(getattr(asp, 'exact', False)),
			'applying': bool(getattr(asp, 'appl', False)),
		}
		if not isinstance(body_a, dict) or not isinstance(body_b, dict):
			return data
		actor, target = body_a, body_b
		a_speed = body_a.get('speed')
		b_speed = body_b.get('speed')
		if (
			body_a.get('kind') == 'planet'
			and body_b.get('kind') == 'planet'
			and a_speed is not None
			and b_speed is not None
		):
			try:
				state = chart.Chart.directed_aspect_state_from_motion(
					int(body_a['index']),
					int(body_b['index']),
					float(body_a['lon']),
					float(a_speed),
					float(body_b['lon']),
					float(b_speed),
					int(asp.typ),
				)
				if state.get('actor_id') == int(body_b['index']):
					actor, target = body_b, body_a
			except Exception:
				pass
		elif body_a.get('kind') != 'planet' and body_b.get('kind') == 'planet':
			actor, target = body_b, body_a
		data['actor'] = actor
		data['target'] = target
		return data

	def _planet_body_info(self, chrt, planet_idx, role='primary'):
		lon = self._get_body_lon(chrt, planet_idx)
		if lon is None:
			return None
		speed = self._get_body_speed_lon(chrt, planet_idx)
		return {
			'kind': 'planet',
			'index': int(planet_idx),
			'lon': float(lon),
			'speed': float(speed) if speed is not None else None,
			'role': role,
		}

	def _angle_body_info(self, chrt, angle_idx):
		try:
			lon = chrt.houses.ascmc[int(angle_idx)]
		except Exception:
			lon = None
		labels = {
			houses.Houses.ASC: 'Asc',
			houses.Houses.MC: 'MC',
		}
		return {
			'kind': 'angle',
			'index': int(angle_idx),
			'label': labels.get(int(angle_idx), 'Angle'),
			'lon': float(lon) if lon is not None else None,
		}

	def _fortune_body_info(self, chrt):
		try:
			lon = chrt.fortune.fortune[fortune.Fortune.LON]
		except Exception:
			lon = None
		return {
			'kind': 'fortune',
			'label': 'Fortune',
			'glyph': common.common.fortune,
			'lon': float(lon) if lon is not None else None,
		}

	def _vertex_body_info(self, chrt):
		try:
			lon = chrt.houses.ascmc[houses.Houses.VERTEX]
		except Exception:
			lon = None
		return {
			'kind': 'vertex',
			'label': 'Vertex',
			'lon': float(lon) if lon is not None else None,
		}

	def _point_body_info(self, lon):
		return {
			'kind': 'point',
			'label': 'Point',
			'lon': float(lon) if lon is not None else None,
		}

	def _draw_aspect_symbol(self, x, y, asp, body_a=None, body_b=None):
		clr = (0, 0, 0)
		if not self.bw:
			clr = self.options.clraspect[asp.typ]
		txt, font_role = common.common.aspect_glyph(asp.typ)
		fnt = self.fntAspectsText if font_role == 'text' else self.fntAspects
		left = x - self.aspectGlyphOffset
		top = y - self.aspectGlyphOffset
		self.draw.text((left, top), txt, fill=clr, font=fnt)
		self._register_text_hover_region(
			'aspect',
			asp.typ,
			txt,
			fnt,
			left,
			top,
			priority=32,
			data=self._aspect_hover_data(asp, body_a=body_a, body_b=body_b),
		)

	def _click_target_kind(self, click_target):
		if isinstance(click_target, dict):
			return click_target.get('kind')
		if isinstance(click_target, tuple) and len(click_target) == 2:
			role, body_id = click_target
			if role == 'hide_all':
				return 'hide_all'
			return 'planet'
		return None

	def _click_target_active(self, click_target):
		return click_target is not None and self._click_target_kind(click_target) != 'hide_all'

	def _click_target_matches_body(self, click_target, chart_role, body_id):
		if isinstance(click_target, dict):
			return (
				click_target.get('kind') == 'planet' and
				click_target.get('chart_role', 'primary') == chart_role and
				click_target.get('planet_index') == body_id
			)
		if isinstance(click_target, tuple) and len(click_target) == 2:
			role, pidx = click_target
			return role == chart_role and pidx == body_id
		return False

	def _click_target_matches_fortune(self, click_target, chart_role):
		return isinstance(click_target, dict) and click_target.get('kind') == 'fortune' and click_target.get('chart_role', 'primary') == chart_role

	def _show_outer_fortune_label(self):
		return bool(getattr(self.options, 'showlof', False) and getattr(self.options, 'showlofouterring', False))

	def _click_target_matches_vertex(self, click_target, chart_role):
		return (
			isinstance(click_target, dict) and
			click_target.get('kind') == 'point' and
			click_target.get('chart_role', 'primary') == chart_role and
			click_target.get('family') == 'vertex'
		)

	def _click_target_point_lon(self, click_target, chart_role):
		if not isinstance(click_target, dict):
			return None
		if click_target.get('kind') != 'point' or click_target.get('chart_role', 'primary') != chart_role:
			return None
		try:
			return float(click_target.get('longitude'))
		except Exception:
			return None

	def _click_aspects_major_only(self):
		return not getattr(self.options, 'exclusive_aspects_on_click_show_minor', True)

	def _is_major_aspect_type(self, aspect_type):
		return aspect_type in (
			chart.Chart.CONJUNCTIO,
			chart.Chart.SEXTIL,
			chart.Chart.QUADRAT,
			chart.Chart.TRIGON,
			chart.Chart.OPPOSITIO,
		)

	def _click_traditional_filter_enabled(self, click_target):
		if not self._click_target_active(click_target):
			return None
		return bool(getattr(self.options, 'exclusive_aspects_on_click_traditional', False))

	def _click_aspect_type_enabled(self, aspect_type):
		if self._click_aspects_major_only() and not self._is_major_aspect_type(aspect_type):
			return False
		return True

	def _passes_render_traditional_filter(self, chrt, aspect_type, lon1, lon2, enabled):
		if not enabled:
			return True
		if aspect_type == chart.Chart.CONJUNCTIO:
			diff = 0
		elif aspect_type == chart.Chart.SEXTIL:
			diff = 2
		elif aspect_type == chart.Chart.QUADRAT:
			diff = 3
		elif aspect_type == chart.Chart.TRIGON:
			diff = 4
		elif aspect_type == chart.Chart.OPPOSITIO:
			diff = 6
		else:
			return False
		lona1 = float(lon1)
		lona2 = float(lon2)
		if getattr(chrt.options, 'ayanamsha', 0) != 0:
			lona1 = util.normalize(lona1 - getattr(chrt, 'ayanamsha', 0.0))
			lona2 = util.normalize(lona2 - getattr(chrt, 'ayanamsha', 0.0))
		sign1 = int(lona1 / chart.Chart.SIGN_DEG)
		sign2 = int(lona2 / chart.Chart.SIGN_DEG)
		signdiff = math.fabs(sign1 - sign2)
		if signdiff > chart.Chart.SIGN_NUM / 2:
			signdiff = chart.Chart.SIGN_NUM - signdiff
		return diff == signdiff

	def _build_render_aspect(self, chrt, lon1, lon2, speed1, speed2, orb_by_aspect, decl1=None, decl2=None, parallel_orbs=None, node_only_conjunction=False, traditional_filter=None):
		asp = chart.Asp()
		asp.dif = chrt._aspect_distance(lon1, lon2)
		if parallel_orbs is not None:
			asp.parallel = chrt._calc_parallel_type(decl1, decl2, parallel_orbs[0], parallel_orbs[1])
		for a in range(chart.Chart.ASPECT_NUM):
			if node_only_conjunction and a > 0:
				break
			if not self._passes_render_traditional_filter(chrt, a, lon1, lon2, bool(traditional_filter)):
				continue
			delta = math.fabs(asp.dif - chart.Chart.Aspects[a])
			if delta > orb_by_aspect[a]:
				continue
			if asp.typ == chart.Chart.NONE or delta < asp.aspdif:
				asp.typ = a
				asp.aspdif = delta
				asp.max_orb = orb_by_aspect[a]
				asp.appl = chrt._is_applying_dynamic(lon1, speed1, lon2, speed2, a)
				asp.exact = delta <= chrt.options.exact
		return asp

	def _should_show_aspect(self, asp, lon1, lon2, click_target=None):
		if asp.typ == chart.Chart.NONE:
			return False
		if not getattr(self.options, 'aspects', False):
			return False
		if self._click_target_active(click_target):
			if not self._click_aspect_type_enabled(asp.typ):
				return False
			if getattr(self.options, 'exclusive_aspects_on_click_traditional', False):
				if not self._passes_render_traditional_filter(self.chart, asp.typ, lon1, lon2, True):
					return False
			return True
		if not self.options.aspect[asp.typ]:
			return False
		return self.isShowAsp(asp.typ, lon1, lon2)

	def _get_planetary_aspect(self, chrt, planet1_idx, planet2_idx, click_target=None):
		traditional_filter = self._click_traditional_filter_enabled(click_target)
		if traditional_filter is None:
			return chrt.get_planetary_aspect(planet1_idx, planet2_idx)
		if {planet1_idx, planet2_idx} == {astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE}:
			return chart.Asp()
		body1 = chrt.get_planet_body(planet1_idx)
		body2 = chrt.get_planet_body(planet2_idx)
		if body1 is None or body2 is None:
			return chart.Asp()
		idx1 = chrt.get_planet_orb_index(planet1_idx)
		idx2 = chrt.get_planet_orb_index(planet2_idx)
		orb_by_aspect = [chrt.options.orbis[idx1][a] + chrt.options.orbis[idx2][a] for a in range(chart.Chart.ASPECT_NUM)]
		parallel_orbs = [
			chrt.options.orbisplanetspar[idx1][0] + chrt.options.orbisplanetspar[idx2][0],
			chrt.options.orbisplanetspar[idx1][1] + chrt.options.orbisplanetspar[idx2][1],
		]
		return self._build_render_aspect(
			chrt,
			body1.data[planets.Planet.LONG],
			body2.data[planets.Planet.LONG],
			body1.data[planets.Planet.SPLON],
			body2.data[planets.Planet.SPLON],
			orb_by_aspect,
			body1.dataEqu[planets.Planet.DECLEQU],
			body2.dataEqu[planets.Planet.DECLEQU],
			parallel_orbs,
			False,
			traditional_filter=traditional_filter,
		)

	def _get_ascmc_aspect(self, chrt, angle_idx, planet_idx, click_target=None):
		traditional_filter = self._click_traditional_filter_enabled(click_target)
		if traditional_filter is None:
			return chrt.get_ascmc_aspect(angle_idx, planet_idx)
		body = chrt.get_planet_body(planet_idx)
		if body is None:
			return chart.Asp()
		idx = chrt.get_planet_orb_index(planet_idx)
		orb_by_aspect = [chrt.options.orbisAscMC[a] + chrt.options.orbis[idx][a] for a in range(chart.Chart.ASPECT_NUM)]
		parallel_orbs = [
			chrt.options.orbisparAscMC[0] + chrt.options.orbisplanetspar[idx][0],
			chrt.options.orbisparAscMC[1] + chrt.options.orbisplanetspar[idx][1],
		]
		decl = chrt.houses.ascmc2[houses.Houses.ASC][houses.Houses.DECL]
		if angle_idx == 1:
			decl = chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.DECL]
		return self._build_render_aspect(
			chrt,
			body.data[planets.Planet.LONG],
			chrt.houses.ascmc[angle_idx],
			body.data[planets.Planet.SPLON],
			0.0,
			orb_by_aspect,
			body.dataEqu[planets.Planet.DECLEQU],
			decl,
			parallel_orbs,
			planet_idx in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE),
			traditional_filter=traditional_filter,
		)

	def _get_lof_aspect(self, chrt, planet_idx, click_target=None):
		traditional_filter = self._click_traditional_filter_enabled(click_target)
		if traditional_filter is None:
			return chrt.get_lof_aspect(planet_idx)
		body = chrt.get_planet_body(planet_idx)
		if body is None:
			return chart.Asp()
		idx = chrt.get_planet_orb_index(planet_idx)
		orb_by_aspect = chrt.options.orbis[idx][:]
		return self._build_render_aspect(
			chrt,
			body.data[planets.Planet.LONG],
			chrt.fortune.fortune[fortune.Fortune.LON],
			body.data[planets.Planet.SPLON],
			0.0,
			orb_by_aspect,
			node_only_conjunction=planet_idx in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE),
			traditional_filter=traditional_filter,
		)

	def _get_point_aspect(self, chrt, planet_idx, lon, click_target=None):
		body = chrt.get_planet_body(planet_idx)
		if body is None:
			return chart.Asp()
		idx = chrt.get_planet_orb_index(planet_idx)
		orb_by_aspect = chrt.options.orbis[idx][:]
		traditional_filter = self._click_traditional_filter_enabled(click_target)
		if traditional_filter is None:
			return chrt._build_dynamic_aspect(
				body.data[planets.Planet.LONG],
				lon,
				body.data[planets.Planet.SPLON],
				0.0,
				orb_by_aspect,
				node_only_conjunction=planet_idx in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE),
			)
		return self._build_render_aspect(
			chrt,
			body.data[planets.Planet.LONG],
			lon,
			body.data[planets.Planet.SPLON],
			0.0,
			orb_by_aspect,
			node_only_conjunction=planet_idx in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE),
			traditional_filter=traditional_filter,
		)

	def get_hover_regions(self):
		return list(self.hover_regions)

	def _color_with_alpha(self, rgb, alpha_ratio):
		"""Blend RGB color with transparency. alpha_ratio 0.0 = opaque, 1.0 = fully transparent."""
		# alpha_ratio is 0 at exact, 1 at max orb
		# We want 100% opacity (255) at exact, fading to ~30% at max orb
		alpha = int(255 * (0.3 + 0.7 * (1 - alpha_ratio)))  # 255 at exact, ~76 at max orb
		return wx.Colour(rgb[0], rgb[1], rgb[2], alpha)

	def _aspect_line_pen(self, asp, exact):
		clr = (0, 0, 0)
		if not self.bw:
			clr = self.options.clraspect[asp.typ]

		if self.options.aspect_thickness_mode:
			if asp.max_orb > 0:
				orb_ratio = min(asp.aspdif / asp.max_orb, 1.0)
				minimum = self._visual_pen_width('aspectClassicThicknessMin', 1)
				maximum = self._visual_pen_width('aspectClassicThicknessMax', 4)
				width = max(minimum, int(round(maximum * (1 - orb_ratio))))
				return wx.Pen(self._color_with_alpha(clr, orb_ratio), width)
			return wx.Pen(
				wx.Colour(clr[0], clr[1], clr[2], 255),
				self._visual_pen_width('aspectClassicThicknessDefault', 2),
			)

		pen = wx.Pen(clr, self._visual_pen_width('aspectClassicWidth', 1))
		if not exact:
			pen = wx.Pen(clr, self._visual_pen_width('aspectClassicWidth', 1), wx.USER_DASH)
			pen.SetDashes([
				max(1, int(round(10 * self._visual_factor('aspectClassicDashOn')))),
				max(1, int(round(10 * self._visual_factor('aspectClassicDashOff')))),
			])
		return pen

	def _draw_aspect_line(self, x1, y1, x2, y2, asp, exact, body_a=None, body_b=None):
		self._register_line_hover_region(
			'aspect',
			asp.typ,
			x1,
			y1,
			x2,
			y2,
			max(4, self._hover_pad() * 0.8),
			priority=18,
			data=self._aspect_hover_data(asp, body_a=body_a, body_b=body_b),
		)
		pen = self._aspect_line_pen(asp, exact)
		gc = getattr(getattr(self, 'draw', None), '_gc', None)
		if gc is not None and hasattr(gc, 'StrokeLine'):
			try:
				gc.SetPen(pen)
				gc.StrokeLine(int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2)))
				return
			except Exception:
				pass
		self.bdc.SetPen(pen)
		self.bdc.DrawLine(x1, y1, x2, y2)

	def _sign_hover_radii(self):
		half_band = max(self.signSize * 0.7, self.symbolSize * 0.6, self._hover_pad() * 1.5)
		return (max(0.0, self.rSign - half_band), self.rSign + half_band)

	def _profile_phase_end(self, phase_name, start_ns, **fields):
		if not hasattr(self, 'profile_phases'):
			self.profile_phases = []
		end_ns = time.perf_counter_ns()
		record = {
			'phase': phase_name,
			'ms': (end_ns - start_ns) / 1_000_000.0,
		}
		record.update(fields)
		self.profile_phases.append(record)
		return end_ns

	def _profile_snapshot(self):
		font_totals = {
			'measure_calls': 0,
			'measure_chars': 0,
			'measure_ms': 0.0,
			'text_calls': 0,
			'text_chars': 0,
			'text_ms': 0.0,
		}
		font_names = (
			'fntMorinus', 'fntSmallMorinus', 'fntMorinusSigns', 'fntAspects', 'fntRetr',
			'fntText', 'fntAntisText', 'fntSmallText2', 'fntSmallText', 'fntSmallTextOuter',
			'fntTinyText', 'fntBigText', 'fntMorinus2',
		)
		font_breakdown = {}
		for name in font_names:
			font = getattr(self, name, None)
			if font is None or not hasattr(font, 'profile_snapshot'):
				continue
			snap = font.profile_snapshot()
			font_breakdown[name] = snap
			for key in ('measure_calls', 'measure_chars', 'measure_ms'):
				font_totals[key] += snap.get(key, 0)
		if hasattr(self, 'draw') and hasattr(self.draw, 'profile_snapshot'):
			draw_snap = self.draw.profile_snapshot()
			font_totals['text_calls'] = draw_snap.get('text_calls', 0)
			font_totals['text_chars'] = draw_snap.get('text_chars', 0)
			font_totals['text_ms'] = draw_snap.get('text_ms', 0.0)
		return {
			'phases': list(getattr(self, 'profile_phases', [])),
			'fonts': font_breakdown,
			'totals': font_totals,
		}


	def drawChart(self):
		self.profile_phases = []
		self._midpoint_ring_label_metrics_cache = {}
		self._midpoint_ring_geometry_cache = None
		self._midpoint_ring_label_pos_cache = {}
		phase_start = time.perf_counter_ns()
		has_aspects = self.theme == self.THEME_CLASSIC
		# PIL can draw only 1-width ellipse (or is there a width=...?)
		self.hover_regions = []
		self.drawCircles()
		phase_start = self._profile_phase_end('circles', phase_start)
		# --- Arabic Parts 안전 초기화(없을 경우 대비) ---
		if not hasattr(self, "apshow"):  self.apshow  = []
		if not hasattr(self, "apshift"): self.apshift = []
		if not hasattr(self, "apyoffs"): self.apyoffs = []
		if not hasattr(self, "_asteroid_ring_rows"): self._asteroid_ring_rows = []
		if not hasattr(self, "showasteroids"): self.showasteroids = []
		if not hasattr(self, "asteroidshift"): self.asteroidshift = []
		if not hasattr(self, "asteroidyoffs"): self.asteroidyoffs = []
		# ---------------------------------------------
		phase_start = self._profile_phase_end('setup', phase_start)

		if self.options.showterms:
			block_start = time.perf_counter_ns()
			self.drawTermsLines()
			phase_start = self._profile_phase_end('terms_lines', block_start)

		if self.options.showdecans:
			block_start = time.perf_counter_ns()
			self.drawDecansLines()
			phase_start = self._profile_phase_end('decans_lines', block_start)

		block_start = time.perf_counter_ns()
		if self.show_houses:
			self.drawHouses(self.chart.houses, self.rBase, self.rInner)

			if self.chart2 != None:
				self.drawHouses(self.chart2.houses, self.r30, self.rOuterMax)
			# Redraw thick circles on top of house lines so lines don't cross
			# them. Skipped in legacy-aesthetic mode: with AA off, a second
			# identical stroke can land on a slightly different pixel set via
			# float-rounded circle rasterization, thickening rInner / rBase
			# by ~1 px relative to the Wine reference. Pre-fork Morinus
			# accepted the house-line/ring crossing artifact rather than
			# redrawing — matching that here preserves stroke weight parity.
			if not bool(getattr(self.options, 'legacypixelated', False)):
				self._redrawMainCircles()
		phase_start = self._profile_phase_end('houses', block_start)

		gc = self.bdc.GetGraphicsContext()
		if gc is None:
			raise RuntimeError('graphics context unavailable')
		# Legacy aesthetic: chart strokes stay aliased (CompatDC has AA off),
		# but glyph text gets AA on per-DrawText — matches Wine, where the
		# Windows GDI font subsystem renders text antialiased independently
		# of stroke AA. Without this override every Morinus glyph would
		# render as chunky pixel bitmap art instead of smooth subpixel curves.
		_text_aa = wx.ANTIALIAS_DEFAULT if bool(getattr(self.options, 'legacypixelated', False)) else None
		self.draw = wxcompat.VectorTextDraw(
			gc,
			getattr(self, '_font_dpi_scale', self._dpi_scale),
			text_antialias_override=_text_aa,
		)
		phase_start = self._profile_phase_end('text_init', phase_start)
		block_start = time.perf_counter_ns()
		if self.show_houses:
			self.drawHouseNames(self.chart, self.rHouseName)
			if self.chart2 != None:
				self.drawHouseNames(self.chart2, self.rOuterHouseName)
		self.drawSigns()
		phase_start = self._profile_phase_end('labels', block_start)

		block_start = time.perf_counter_ns()
		self.drawAscMC(self.chart.houses.ascmc, self.rBase, self.rASCMC, self.rArrow)
		if self.chart2 != None:
			self.drawAscMC(self.chart2.houses.ascmc, self.rOuterMin, self.rOuterASCMC, self.rOuterArrow)

		#calc shift of planets (in order to avoid overlapping)
		# Glyph + tick line use pshift (legacy-parity, glyph-rectangle collision
		# only at rPlanet — keeps ticks short). label_pshift stays equal to
		# pshift in this mode (no angular drift). label_yoffs is a per-body
		# radial offset (in pixels) so adjacent inner labels in tight clusters
		# alternate between two radial layers, A/B/A/B, like arrangeyParts does
		# for Arabic parts — no angular drift, no halos, no leader lines.
		self.pshift, self.label_pshift, self.label_yoffs = self.arrange(self.chart, self.rPlanet, include_details=True, rRetr=self.rRetr, outer=False)
		phase_start = self._profile_phase_end('arrange_primary', block_start)
		block_start = time.perf_counter_ns()
		#PIL doesn't want to show short lines
		if has_aspects:
			self.drawPlanetLines(self.chart, self.pshift, self.rInner, self.rLLine, self.rAsp, self.rLLine2)
		else:
			self.drawPlanetLines(self.chart, self.pshift, self.rInner, self.rLLine)
		if self.chart2 != None:
			self.pshift2, self.label_pshift2, self.label_yoffs2 = self.arrange(self.chart2, self.rOuterPlanet, include_details=True, rRetr=self.rOuterRetr, outer=True)
			self.drawPlanetLines(self.chart2, self.pshift2, self.r30, self.rOuterLine)
		phase_start = self._profile_phase_end('planet_lines', block_start)

		#PIL can't draw dashed lines
		block_start = time.perf_counter_ns()
		show_clicked_aspects = bool(
			self.options.aspects and
			getattr(self.options, 'exclusive_aspects_on_click', False) and
			self._click_target_active(self.click_planet)
		)
		if has_aspects and (self.options.aspects or show_clicked_aspects):
			_click = self.click_planet if getattr(self.options, 'exclusive_aspects_on_click', False) else None
			if self.chart2 != None:
				interchart_aspects = self.getInterChartAspects(click_planet=_click)
				self.drawInterChartAspectMarkers(interchart_aspects, click_planet=_click)
				self.drawInterChartAspectLines(interchart_aspects, click_planet=_click)
			else:
				self.drawAspectLines(click_planet=_click)
				if (self.options.showlof and self.options.showaspectstolof) or self._click_target_matches_fortune(_click, 'primary'):
					self.drawLoFAspectLines(click_planet=_click)
				if (self.options.showvertex and getattr(self.options, 'showaspectstovertex', False)) or self._click_target_matches_vertex(_click, 'primary'):
					self.drawVertexAspectLines(click_planet=_click)
				self.drawClickedPointAspectLines(click_planet=_click)
		phase_start = self._profile_phase_end('aspect_lines', block_start)

		#if self.chart2 == None and self.planetaryday and self.options.showfixstars != options.Options.NONE:  # radix 차트
		block_start = time.perf_counter_ns()
		if (self.chart2 == None and self.options.showfixstars != options.Options.NONE) or (self.chart2 != None and self.options.showfixstars == options.Options.ARABICPARTS):
			if self.options.showfixstars == options.Options.FIXSTARS:
				self.showfss = []
				fsdata = getattr(getattr(self.chart, 'fixstars', None), 'data', None)
				if not fsdata:
					try:
						self.chart.rebuildFixStars()
					except Exception:
						pass
					fsdata = getattr(getattr(self.chart, 'fixstars', None), 'data', None)
				if fsdata:
					self.showfss = self.mergefsaspmatrices()
					_rText = self.rOuterLine + self._outer_radius_offset()
					self.fsshift = self.arrangefs(fsdata, self.showfss, _rText)

					_rText = self.rOuterLine + self._outer_radius_offset()
					self.fsyoffs = self.arrangeyfs(fsdata, self.fsshift, self.showfss, _rText)
					self.drawFixstarsLines(self.showfss)
				else:
					# 데이터가 없으면 고정성 블록 전체를 스킵
					self.fsshift = []

			elif self.options.showfixstars == options.Options.ASTEROIDS:
				self.showasteroids = []
				self._asteroid_ring_items = common.collect_asteroid_ring_items(self.chart, self.options)
				self._asteroid_ring_rows = common.build_ring_text_rows(self._asteroid_ring_items)
				if self._asteroid_ring_rows:
					self.showasteroids = list(range(len(self._asteroid_ring_rows)))
					_rText = self.rOuterLine + self._outer_radius_offset()
					self.asteroidshift = self.arrangefs(self._asteroid_ring_rows, self.showasteroids, _rText)
					self.asteroidyoffs = self.arrangeyfs(self._asteroid_ring_rows, self.asteroidshift, self.showasteroids, _rText)
					self.drawAsteroidsLines(self._asteroid_ring_rows, self.showasteroids, self.asteroidshift)
				else:
					self.asteroidshift = []
					self.asteroidyoffs = []

			elif self.options.showfixstars == options.Options.MIDPOINTS:
				self.showmidpoints = []
				self._midpoint_ring_items = common.collect_midpoint_ring_items(self.chart, self.options)
				if self._midpoint_ring_items:
					self.showmidpoints = list(range(len(self._midpoint_ring_items)))
					_rText = self.rOuterLine + self._outer_radius_offset()
					self.midpointshift, self.midpointyoffs = self._midpoint_ring_layout(
						self._midpoint_ring_items,
						self.showmidpoints,
						_rText,
					)
					self.drawMidpointLines(self._midpoint_ring_items, self.showmidpoints, self.midpointshift)
				else:
					self.midpointshift = []
					self.midpointyoffs = []

			elif self.options.showfixstars == options.Options.HYBRID_HITS:
				self.showhybridhits = []
				self._ensure_ap_for_chart(self.chart)
				fsdata = getattr(getattr(self.chart, 'fixstars', None), 'data', None)
				if not fsdata:
					try:
						self.chart.rebuildFixStars()
					except Exception:
						pass
				self._hybrid_ring_items = common.collect_hybrid_ring_items(self.chart, self.options)
				self._hybrid_ring_rows = common.build_ring_text_rows(self._hybrid_ring_items)
				if self._hybrid_ring_rows:
					self.showhybridhits = list(range(len(self._hybrid_ring_rows)))
					_rText = self.rOuterLine + self._outer_radius_offset()
					self.hybridhitshift = self.arrangefs(self._hybrid_ring_rows, self.showhybridhits, _rText)
					self.hybridhityoffs = self.arrangeyfs(self._hybrid_ring_rows, self.hybridhitshift, self.showhybridhits, _rText)
					self.drawAsteroidsLines(self._hybrid_ring_rows, self.showhybridhits, self.hybridhitshift)
				else:
					self.hybridhitshift = []
					self.hybridhityoffs = []

			elif self.options.showfixstars == options.Options.ANTIS:
				pl, lo, am = self._get_overlay_data('ANTIS')
				self.pshiftantis = self.arrangeAntis(pl, lo, am, self.rAntis)
				self.drawAntisLines(pl, lo, am, self.pshiftantis, self.r30, self.rAntisLines)

			elif self.options.showfixstars == options.Options.DODECATEMORIA:
				pl, lo, am = self._get_overlay_data('DODEC')
				self.pshiftantis = self.arrangeAntis(pl, lo, am, self.rAntis)
				self.drawAntisLines(pl, lo, am, self.pshiftantis, self.r30, self.rAntisLines)

			elif self.options.showfixstars == options.Options.CANTIS:
				pl, lo, am = self._get_overlay_data('CANTIS')
				self.pshiftantis = self.arrangeAntis(pl, lo, am, self.rAntis)
				self.drawAntisLines(pl, lo, am, self.pshiftantis, self.r30, self.rAntisLines)

			elif self.options.showfixstars == options.Options.ARABICPARTS:
				drew_parts = False
				for is_outer, C in (((True, self.chart2),) if self.chart2 is not None else ((False, self.chart),)):
					self._ensure_ap_for_chart(C)
					parts_obj = getattr(C, 'parts', None)
					if not (parts_obj and getattr(parts_obj, 'parts', None)):
						continue

					parts_ap = list(parts_obj.parts)
					if self._show_outer_fortune_label():
						try:
							lof_lon  = C.fortune.fortune[fortune.Fortune.LON]
							lof_name = mtexts.txts.get('LotOfFortune', 'Fortuna')
							parts_ap.append({ arabicparts.ArabicParts.LONG: lof_lon,
											arabicparts.ArabicParts.NAME: lof_name })
						except Exception:
							pass

					if is_outer:
						self._parts_ap2 = parts_ap
						self.apshow2 = list(range(len(parts_ap)))
						_rText = self.rOuterLine + self._outer_radius_offset()
						self.apshift2 = self.arrangeParts(parts_ap, self.apshow2, _rText)
						self.apyoffs2 = self.arrangeyParts(parts_ap, self.apshow2, self.apshift2, _rText)
						self.drawArabicPartsLines(parts_ap, self.apshow2, self.apshift2, C)
					else:
						self._parts_ap = parts_ap
						self.apshow = list(range(len(parts_ap)))
						_rText = self.rOuterLine + self._outer_radius_offset()
						self.apshift = self.arrangeParts(parts_ap, self.apshow, _rText)
						self.apyoffs = self.arrangeyParts(parts_ap, self.apshow, self.apshift, _rText)
						self.drawArabicPartsLines(parts_ap, self.apshow, self.apshift, C)
					drew_parts = True

				if not drew_parts:
					self._fortune_outer_shift = 0.0
					if self._show_outer_fortune_label():
						self.drawOuterFortuneLine(self.chart2 if self.chart2 is not None else self.chart)
		phase_start = self._profile_phase_end('overlay_setup', block_start)


		block_start = time.perf_counter_ns()
		defer_detail = bool(getattr(self, 'defer_expensive_overlay', False))
		self.drawPlanets(self.chart, self.pshift, self.rPlanet, self.rRetr, label_pshift=self.label_pshift, label_yoffs=self.label_yoffs)
		if self.chart2 != None:
			self.drawPlanets(self.chart2, self.pshift2, self.rOuterPlanet, self.rOuterRetr, True, label_pshift=self.label_pshift2, label_yoffs=self.label_yoffs2)
		self._register_empty_midband_click_region()
		phase_start = self._profile_phase_end('planet_draw', block_start, defer=int(defer_detail))

		if self.options.showterms:
			self.drawTerms()

		if self.options.showdecans:
			self.drawDecans()

		if has_aspects and self.options.symbols and (self.options.aspects or show_clicked_aspects):
			_click = self.click_planet if getattr(self.options, 'exclusive_aspects_on_click', False) else None
			if self.chart2 == None:
				self.drawAspectSymbols(click_planet=_click)
				if (self.options.showlof and self.options.showaspectstolof) or self._click_target_matches_fortune(_click, 'primary'):
					self.drawLoFAspectSymbols(click_planet=_click)
				if (self.options.showvertex and getattr(self.options, 'showaspectstovertex', False)) or self._click_target_matches_vertex(_click, 'primary'):
					self.drawVertexAspectSymbols(click_planet=_click)
				self.drawClickedPointAspectSymbols(click_planet=_click)
			else:
				self.drawInterChartAspectSymbols(interchart_aspects, click_planet=_click)

		block_mid = time.perf_counter_ns()
		if self.options.positions:
			self.drawAscMCPos()
			if self.show_houses:
				self.drawHousePos()
		phase_start = self._profile_phase_end('positions', block_mid)

		#if self.options.planetarydayhour and self.planetaryday:
		block_mid = time.perf_counter_ns()
		# Day/Hour now drawn inside drawOverlayInfoBlock()
		phase_start = self._profile_phase_end('planetary_dayhour', block_mid)

		block_mid = time.perf_counter_ns()
		self.drawOverlayInfoBlock()
		phase_start = self._profile_phase_end('overlay_info', block_mid)

		#if self.options.housesystem and self.planetaryday:
		block_mid = time.perf_counter_ns()
		if self.options.housesystem:
			self.drawHousesystemName()
		phase_start = self._profile_phase_end('housesystem', block_mid)

		# chart meta labels (inside wheel)
		block_mid = time.perf_counter_ns()
		if getattr(self.options, 'information', True):
			self.drawChartTimeTopLeft()
		phase_start = self._profile_phase_end('chart_time', block_mid)

		block_mid = time.perf_counter_ns()
		if getattr(self.options, 'information', True):
			self.drawChartPlaceBottomLeft()
		phase_start = self._profile_phase_end('chart_place', block_mid)
		phase_start = self._profile_phase_end('core_draw', block_start)

		#if self.chart2 == None and self.planetaryday and self.options.showfixstars != options.Options.NONE:  # radix 차트
		block_start = time.perf_counter_ns()
		if (self.chart2 == None and self.options.showfixstars != options.Options.NONE) or (self.chart2 != None and self.options.showfixstars == options.Options.ARABICPARTS):
			if self.options.showfixstars == options.Options.FIXSTARS:
				self.drawFixstars(self.showfss)

			elif self.options.showfixstars == options.Options.ASTEROIDS:
				self.drawAsteroids(self._asteroid_ring_rows, self.showasteroids, self.asteroidshift, self.asteroidyoffs)

			elif self.options.showfixstars == options.Options.MIDPOINTS:
				self.drawMidpoints(self._midpoint_ring_items, self.showmidpoints, self.midpointshift, self.midpointyoffs)

			elif self.options.showfixstars == options.Options.HYBRID_HITS:
				self.drawAsteroids(self._hybrid_ring_rows, self.showhybridhits, self.hybridhitshift, self.hybridhityoffs)

			elif self.options.showfixstars == options.Options.ANTIS:
				pl, lo, am = self._get_overlay_data('ANTIS')
				self.drawAntis(self.chart, pl, lo, am, self.pshiftantis, self.rAntis)

			elif self.options.showfixstars == options.Options.DODECATEMORIA:
				pl, lo, am = self._get_overlay_data('DODEC')
				self.drawAntis(self.chart, pl, lo, am, self.pshiftantis, self.rAntis)

			elif self.options.showfixstars == options.Options.CANTIS:
				pl, lo, am = self._get_overlay_data('CANTIS')
				self.drawAntis(self.chart, pl, lo, am, self.pshiftantis, self.rAntis)

			elif self.options.showfixstars == options.Options.ARABICPARTS:
				drew = False
				if hasattr(self, "_parts_ap2") and hasattr(self, "apshow2") and hasattr(self, "apshift2") and hasattr(self, "apyoffs2") and self.chart2 is not None:
					self.drawArabicParts(self._parts_ap2, self.apshow2, self.apshift2, self.apyoffs2, C=self.chart2)
					drew = True
				if self.chart2 is None and hasattr(self, "_parts_ap") and hasattr(self, "apshow") and hasattr(self, "apshift") and hasattr(self, "apyoffs"):
					self.drawArabicParts(self._parts_ap, self.apshow, self.apshift, self.apyoffs, C=self.chart)
					drew = True
				if not drew:
					if self._show_outer_fortune_label():
						self.drawOuterFortuneText(self.chart2 if self.chart2 is not None else self.chart)
		phase_start = self._profile_phase_end('overlay_draw', block_start)

		# Persistent zodiacal surveil marks (per-session). Draw on top so they
		# remain visible across supplementary charts within the same tab.
		self.drawSurveilMarks()

		self.profile_summary = self._profile_snapshot()

		return self.buffer


	def drawCircles(self):
		def _i(v):
			return int(round(v))

		bkgclr = self.options.clrbackground
		if self.bw:
			bkgclr = (255, 255, 255)
		self.bdc.SetBackground(wx.Brush(bkgclr))
		self.bdc.Clear()
#		self.bdc.BeginDrawing()

		self.bdc.SetBrush(wx.Brush(bkgclr))

		(cx, cy) = self.center.Get()

		# rOuterMax and rOuterHouse (for outer housenames)
		if self.chart2 is not None and self.show_houses:
			clr = self.options.clrframe
			if self.bw:
				clr = (0, 0, 0)
			pen = wx.Pen(clr, self._hairline_width())
			self.bdc.SetPen(pen)
			self.bdc.DrawCircle(cx, cy, _i(self.rOuterMax))
			self.bdc.DrawCircle(cx, cy, _i(self.rOuterHouse))

		# Ensure the main r30 ring exists even without overlays.
		if self.chart2 is None and self.options.showfixstars == options.Options.NONE:
			clr = self.options.clrframe
			if self.bw:
				clr = (0, 0, 0)
			w = self._scaled_line_w(self._ring_stroke_width())
			pen = wx.Pen(clr, w)
			self.bdc.SetPen(pen)
			self.bdc.DrawCircle(cx, cy, _i(self.r30))

		# r30 ring and outer rings when overlay/transit is present
		if self.chart2 is not None or (self.options.showfixstars != options.Options.NONE):
			clr = self.options.clrframe
			if self.bw:
				clr = (0, 0, 0)

			w = self._scaled_line_w(self._ring_stroke_width())

			pen = wx.Pen(clr, w)
			self.bdc.SetPen(pen)
			self.bdc.DrawCircle(cx, cy, _i(self.r30))

			# Outer 10, 5, 1-circle
			pen = wx.Pen(clr, self._hairline_width())
			self.bdc.SetPen(pen)
			self.bdc.DrawCircle(cx, cy, _i(self.rOuter10))

		# r10 Circle
		clr = self.options.clrframe
		if self.bw:
			clr = (0, 0, 0)
		pen = wx.Pen(clr, self._hairline_width())
		self.bdc.SetPen(pen)
		self.bdc.DrawCircle(cx, cy, _i(self.r10))

		# r0 Circle
		clr = self.options.clrframe
		if self.bw:
			clr = (0, 0, 0)

		if self.options.showterms or self.options.showdecans:
			pen = wx.Pen(clr, self._hairline_width())
			self.bdc.SetPen(pen)
			self.bdc.DrawCircle(cx, cy, _i(self.r0))

			# Decans Circle
			if self.options.showterms:
				clr = self.options.clrframe
				if self.bw:
					clr = (0, 0, 0)
				pen = wx.Pen(clr, self._hairline_width())
				self.bdc.SetPen(pen)
				self.bdc.DrawCircle(cx, cy, _i(self.rDecans))

		# rInner circle
		clr = self.options.clrframe
		if self.bw:
			clr = (0, 0, 0)
		w = self._scaled_line_w(self._ring_stroke_width())

		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)
		self.bdc.DrawCircle(cx, cy, _i(self.rInner))

		if self.theme == self.THEME_CLASSIC:
			# rAsp Circle
			clr = self.options.clrframe
			if self.bw:
				clr = (0, 0, 0)
			pen = wx.Pen(clr, self._hairline_width())
			self.bdc.SetPen(pen)
			self.bdc.DrawCircle(cx, cy, _i(self.rAsp))

		# rHouse Circle
		if self.show_houses:
			clr = self.options.clrhouses
			if self.bw:
				clr = (0, 0, 0)
			pen = wx.Pen(clr, self._hairline_width())
			self.bdc.SetPen(pen)
			self.bdc.DrawCircle(cx, cy, _i(self.rHouse))

		# Base Circle
		clr = self.options.clrAscMC
		if self.bw:
			clr = (0, 0, 0)

		w = self._scaled_line_w(self._ascmc_base_width())

		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)
		self.bdc.DrawCircle(cx, cy, _i(self.rBase))

		asclon = self._rotation_asc(sidereal=True)

		# 30-degs
		clr = self.options.clrframe
		if self.bw:
			clr = (0, 0, 0)
		w = self._scaled_line_w(self._ring_stroke_width())

		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)
		self.drawLines(GraphChart.DEG30, asclon, self.rInner, self.r30)

		# 10-degs
		clr = self.options.clrframe
		if self.bw:
			clr = (0, 0, 0)
		w = self._degree_tick_width()

		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)
		self.drawLines(GraphChart.DEG10, asclon, self.r0, self.r10)

		# 5-degs
		self.drawLines(GraphChart.DEG5, asclon, self.r0, self.r5)
		# 1-degs
		clr = self.options.clrframe
		if self.bw:
			clr = (0, 0, 0)
		pen = wx.Pen(clr, self._hairline_width())
		self.bdc.SetPen(pen)
		self.drawLines(GraphChart.DEG1, asclon, self.r0, self.r1)

		# Outer 10, 5, 1 -degs
		if self.chart2 is not None or (self.options.showfixstars != options.Options.NONE):
			# 10-degs
			clr = self.options.clrframe
			if self.bw:
				clr = (0, 0, 0)
			w = self._degree_tick_width()

			pen = wx.Pen(clr, w)
			self.bdc.SetPen(pen)
			self.drawLines(GraphChart.DEG10, asclon, self.rOuter0, self.rOuter10)

			# 5-degs
			self.drawLines(GraphChart.DEG5, asclon, self.rOuter0, self.rOuter5)
			# 1-degs
			clr = self.options.clrframe
			if self.bw:
				clr = (0, 0, 0)
			pen = wx.Pen(clr, self._hairline_width())
			self.bdc.SetPen(pen)
			self.drawLines(GraphChart.DEG1, asclon, self.rOuter0, self.rOuter1)

		#self.bdc.EndDrawing()


	def _redrawMainCircles(self):
		"""Redraw the thick rInner and rBase circles so house lines don't cross them."""
		_i = lambda v: int(round(v))
		(cx, cy) = self.center.Get()

		clr = self.options.clrframe
		if self.bw:
			clr = (0, 0, 0)
		w = self._scaled_line_w(self._ring_stroke_width())
		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)
		self.bdc.SetBrush(wx.TRANSPARENT_BRUSH)
		self.bdc.DrawCircle(cx, cy, _i(self.rInner))

		clr = self.options.clrAscMC
		if self.bw:
			clr = (0, 0, 0)
		w = self._scaled_line_w(self._ascmc_base_width())
		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)
		self.bdc.DrawCircle(cx, cy, _i(self.rBase))

	def drawSigns(self):
		(cx, cy) = self.center.Get()
		j = 0
		asclon = self._rotation_asc(sidereal=True)
		i = math.pi+math.radians(asclon)-GraphChart.DEG30/2

		signs = common.common.Signs1
		if not self.options.signs:
			signs = common.common.Signs2
		inner_radius, outer_radius = self._sign_hover_radii()

		while j < chart.Chart.SIGN_NUM:
			clr = common.get_sign_color(self.options, j, bw=self.bw)
			x = cx+math.cos(i)*self.rSign
			y = cy+math.sin(i)*self.rSign
			self.draw.text((x-self.signSize/2, y-self.signSize/2), signs[j], font=self.fntMorinusSigns, fill=clr)
			self._register_sector_hover_region(
				'sign',
				j,
				cx,
				cy,
				inner_radius,
				outer_radius,
				util.normalize(math.degrees(i - GraphChart.DEG30/2)),
				util.normalize(math.degrees(i + GraphChart.DEG30/2)),
				priority=10,
				data={'ruler_index': self._domicile_ruler_for_sign(j), 'colour': clr},
			)
			i -= GraphChart.DEG30
			j += 1

	def _domicile_ruler_for_sign(self, sign):
		sign = int(sign) % chart.Chart.SIGN_NUM
		try:
			for candidate in range(astrology.SE_SUN, astrology.SE_SATURN + 1):
				if self.options.dignities[candidate][0][sign]:
					return candidate
		except Exception:
			pass
		return (4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 6, 5)[sign]


	def drawHouses(self, chouses, r1, r2):
		(cx, cy) = self.center.Get()
		clr = self.options.clrhouses
		if self.bw:
			clr = (0,0,0)
		pen = wx.Pen(clr, self._hairline_width())
		self.bdc.SetPen(pen)
		asc = self._display_house_anchor()
		chrt = self.chart if chouses is self.chart.houses else self.chart2
		for i in range (1, houses.Houses.HOUSE_NUM+1):
			cusp = self._display_house_cusp(chrt, i)
			dif = math.radians(util.normalize(asc-cusp))
			x1 = cx+math.cos(math.pi+dif)*r1
			y1 = cy+math.sin(math.pi+dif)*r1
			x2 = cx+math.cos(math.pi+dif)*r2
			y2 = cy+math.sin(math.pi+dif)*r2
			self.bdc.DrawLine(x1, y1, x2, y2)
	

	def drawAscMC(self, ascmc, r1, r2, rArrow):
		(cx, cy) = self.center.Get()
		asc_lon = self._angle_lon(self.chart2 if self.chart2 != None and rArrow == self.rOuterArrow else self.chart, houses.Houses.ASC)
		mc_lon = self._angle_lon(self.chart2 if self.chart2 != None and rArrow == self.rOuterArrow else self.chart, houses.Houses.MC)
		if asc_lon is None or mc_lon is None:
			return
		#AscMC
		clr = self.options.clrAscMC
		if self.bw:
			clr = (0,0,0)
		w = self._scaled_line_w(self._ascmc_base_width())

		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)
		angle_ids = ('asc', 'desc', 'mc', 'ic')
		angle_lons = (
			asc_lon,
			util.normalize(asc_lon + 180.0),
			mc_lon,
			util.normalize(mc_lon + 180.0),
		)
		chart_role = 'outer' if self.chart2 != None and rArrow == self.rOuterArrow else 'primary'
		role_chart = self.chart2 if chart_role == 'outer' and self.chart2 != None else self.chart
		display_angle_lons = list(angle_lons)
		if self.options.ayanamsha != 0:
			display_angle_lons = [util.normalize(lon - role_chart.ayanamsha) for lon in angle_lons]

		for i in range(4):
			ang = math.pi+math.radians(self._rotation_asc())
			if i == 0:
				ang -= math.radians(ascmc[houses.Houses.ASC])
			if i == 1:
				ang -= math.radians(ascmc[houses.Houses.ASC])+math.pi
			if i == 2:
				ang -= math.radians(ascmc[houses.Houses.MC])
			if i == 3:
				ang -= math.radians(ascmc[houses.Houses.MC])+math.pi

			r2comma = r2
			if self.chart2 != None and rArrow == self.rOuterArrow and i != 0 and i != 2:
				r2comma = rArrow

			x1 = cx+math.cos(ang)*r1
			y1 = cy+math.sin(ang)*r1
			x2 = cx+math.cos(ang)*r2comma
			y2 = cy+math.sin(ang)*r2comma
			self.bdc.DrawLine(x1, y1, x2, y2)
			self._register_point_hover_region(
				'angle',
				angle_ids[i],
				x2,
				y2,
				chart_role=chart_role,
				priority=30,
				data={'longitude': angle_lons[i], 'display_lon': display_angle_lons[i], 'colour': clr},
			)

			if i == 0 or i == 2:
				self.drawArrow(ang, r2, clr, rArrow)


	def drawArrow(self, ang, r2, clr, rArrow):
		(cx, cy) = self.center.Get()
		offs = math.pi/360.0 

		xl = cx+math.cos(ang+offs)*r2
		yl = cy+math.sin(ang+offs)*r2
		xr = cx+math.cos(ang-offs)*r2
		yr = cy+math.sin(ang-offs)*r2
		xm = cx+math.cos(ang)*rArrow
		ym = cy+math.sin(ang)*rArrow

		li = ((xl, yl, xr, yr), (xr, yr, xm, ym), (xm, ym, xl, yl))
		self.bdc.DrawLineList(li)

#		self.bdc.SetBrush(wx.Brush(clr))	

#		x = (xl+xr)/2
#		x = (x+xm)/2
#		y = (yl+yr)/2
#		y = (y+ym)/2	

#		self.bdc.FloodFill(x, y, clr, wx.FLOOD_BORDER)


	def drawAscMCPos(self):
		(cx, cy) = self.center.Get()
		clrpos = self.options.clrpositions
		if self.bw:
			clrpos = (0,0,0)
		for i in range(2):
			lon = self._angle_lon(self.chart, i)
			if lon is None:
				continue
			if self.options.ayanamsha != 0:
				lon = util.normalize(lon-self.chart.ayanamsha)

			(d, m, s) = util.decToDeg(lon)
			object_id = 'asc' if i == 0 else 'mc'
			angle_lon = self._angle_lon(self.chart, i)
			if angle_lon is None:
				continue

			if self.theme == self.THEME_CLASSIC:
				d = d%chart.Chart.SIGN_DEG

				wdeg, hdeg = self.draw.textsize(str(d), self.fntDegreeText)
				wmin, hmin = self.draw.textsize((str(m).zfill(2)), self.fntMinuteText)
				x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-angle_lon))*self.rPosAscMC
				y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-angle_lon))*self.rPosAscMC
				xdeg = x-wdeg/2
				ydeg = y-hdeg/2
				self._draw_text_haloed((xdeg, ydeg), str(d), fill=clrpos, font=self.fntDegreeText)
				self._draw_text_haloed((xdeg+wdeg, ydeg), (str(m)).zfill(2), fill=clrpos, font=self.fntMinuteText)
				self._register_hover_region(
					'angle',
					object_id,
					xdeg,
					ydeg,
					wdeg + wmin,
					max(hdeg, hmin),
					priority=34,
					data={'longitude': self.chart.houses.ascmc[i], 'display_lon': lon, 'colour': clrpos},
				)
			else:
				d, m = util.roundDeg(d%chart.Chart.SIGN_DEG, m, s)

				degtxt = str(d)+self.deg_symbol
				wdeg, hdeg = self.draw.textsize(degtxt, self.fntDegreeText)
				x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-angle_lon))*self.rPosHouses
				y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-angle_lon))*self.rPosHouses
				xdeg = x-wdeg/2
				ydeg = y-hdeg/2
				self._draw_text_haloed((xdeg, ydeg), degtxt, fill=clrpos, font=self.fntDegreeText)
				self._register_text_hover_region(
					'angle',
					object_id,
					degtxt,
					self.fntText,
					xdeg,
					ydeg,
					priority=34,
					data={'longitude': self.chart.houses.ascmc[i], 'display_lon': lon, 'colour': clrpos},
				)

				mintxt = str(m)+"'"
				wdeg, hdeg = self.draw.textsize(mintxt, self.fntMinuteText)
				x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-angle_lon))*self.rPosHousesMin
				y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-angle_lon))*self.rPosHousesMin
				xdeg = x-wdeg/2
				ydeg = y-hdeg/2
				self.draw.text((xdeg, ydeg), mintxt, fill=clrpos, font=self.fntMinuteText)
				self._register_text_hover_region(
					'angle',
					object_id,
					mintxt,
					self.fntMinuteText,
					xdeg,
					ydeg,
					priority=34,
					data={'longitude': self.chart.houses.ascmc[i], 'display_lon': lon, 'colour': clrpos},
				)


	def drawHousePos(self):
		(cx, cy) = self.center.Get()
		clrpos = self.options.clrpositions
		if self.bw:
			clrpos = (0,0,0)
		skipasc = False
		skipmc = False
		if self.chart.houses.cusps[1] == self.chart.houses.ascmc[houses.Houses.ASC]:
			skipasc = True
		if self.chart.houses.cusps[10] == self.chart.houses.ascmc[houses.Houses.MC]:
			skipmc = True

		asc = self._display_house_anchor()
		for i in range (1, houses.Houses.HOUSE_NUM+1):
			if i >= 4 and i < 10:
				continue
			if (skipasc and i == 1) or (skipmc and i == 10):
				continue

			lon = self._display_house_cusp(self.chart, i)
			(d, m, s) = util.decToDeg(lon)
			if self.theme == self.THEME_CLASSIC:
				d = d%chart.Chart.SIGN_DEG

				wdeg, hdeg = self.draw.textsize(str(d), self.fntDegreeText)
				wmin, hmin = self.draw.textsize((str(m).zfill(2)), self.fntMinuteText)
				x = cx+math.cos(math.pi+math.radians(asc-lon))*self.rPosHouses
				y = cy+math.sin(math.pi+math.radians(asc-lon))*self.rPosHouses
				xdeg = x-wdeg/2
				ydeg = y-hdeg/2
				self._draw_text_haloed((xdeg, ydeg), str(d), fill=clrpos, font=self.fntDegreeText)
				self._draw_text_haloed((xdeg+wdeg, ydeg), (str(m)).zfill(2), fill=clrpos, font=self.fntMinuteText)
				self._register_hover_region(
					'house',
					i,
					xdeg,
					ydeg,
					wdeg + wmin,
					max(hdeg, hmin),
					priority=22,
					data={'longitude': self.chart.houses.cusps[i], 'display_lon': lon, 'colour': clrpos, 'chart': self.chart},
				)
			else:
				d, m = util.roundDeg(d%chart.Chart.SIGN_DEG, m, s)

				degtxt = str(d)+self.deg_symbol
				wdeg, hdeg = self.draw.textsize(degtxt, self.fntDegreeText)
				x = cx+math.cos(math.pi+math.radians(asc-lon))*self.rPosHouses
				y = cy+math.sin(math.pi+math.radians(asc-lon))*self.rPosHouses
				xdeg = x-wdeg/2
				ydeg = y-hdeg/2
				self._draw_text_haloed((xdeg, ydeg), degtxt, fill=clrpos, font=self.fntDegreeText)
				self._register_text_hover_region(
					'house',
					i,
					degtxt,
					self.fntText,
					xdeg,
					ydeg,
					priority=22,
					data={'longitude': self.chart.houses.cusps[i], 'display_lon': lon, 'colour': clrpos, 'chart': self.chart},
				)

				mintxt = str(m)+"'"
				wdeg, hdeg = self.draw.textsize(mintxt, self.fntMinuteText)
				x = cx+math.cos(math.pi+math.radians(asc-lon))*self.rPosHousesMin
				y = cy+math.sin(math.pi+math.radians(asc-lon))*self.rPosHousesMin
				xdeg = x-wdeg/2
				ydeg = y-hdeg/2
				self.draw.text((xdeg, ydeg), mintxt, fill=clrpos, font=self.fntMinuteText)
				self._register_text_hover_region(
					'house',
					i,
					mintxt,
					self.fntMinuteText,
					xdeg,
					ydeg,
					priority=22,
					data={'longitude': self.chart.houses.cusps[i], 'display_lon': lon, 'colour': clrpos, 'chart': self.chart},
				)


	def drawHouseNames(self, chrt, rHouseNames):
		(cx, cy) = self.center.Get()
		clr = self.options.clrhousenumbers
		if self.bw:
			clr = (0,0,0)
		pen = wx.Pen(clr, self._hairline_width())
		self.bdc.SetPen(pen)
		asc = self._display_house_anchor()
		house_font = self.fntOuterHouseText if chrt is self.chart2 else self.fntHouseText
		house_symbol_size = self.outerSymbolSize if chrt is self.chart2 else self.symbolSize
		for i in range (1, houses.Houses.HOUSE_NUM+1):
			cusp = self._display_house_cusp(chrt, i)
			next_cusp = self._display_house_cusp(chrt, i+1 if i != houses.Houses.HOUSE_NUM else 1)
			width = util.normalize(next_cusp-cusp)
			halfwidth = math.radians(width/2.0)
			dif = math.radians(util.normalize(asc-cusp))
			
			x = cx+math.cos(math.pi+dif-halfwidth)*rHouseNames
			y = cy+math.sin(math.pi+dif-halfwidth)*rHouseNames
			if i == 1 or i == 2:
				xoffs = 0
				yoffs = house_symbol_size/4 * self._visual_factor('houseClassicOffsetScale')
				if i == 2:
					xoffs = house_symbol_size/8 * self._visual_factor('houseSecondOffsetScale')
			else:
				xoffs = house_symbol_size/4 * self._visual_factor('houseClassicOffsetScale')
				yoffs = house_symbol_size/4 * self._visual_factor('houseClassicOffsetScale')

			self.draw.text((x-xoffs,y-yoffs), common.common.Housenames[i-1], fill=clr, font=house_font)
			self._register_text_hover_region(
				'house',
				i,
				common.common.Housenames[i-1],
				house_font,
				x - xoffs,
				y - yoffs,
				priority=24,
				data={'longitude': chrt.houses.cusps[i], 'display_lon': cusp, 'colour': clr, 'chart': chrt},
			)
	

	def _draw_text_haloed(self, xy, text, fill, font, halo_px=0):
		"""Halo disabled — single text draw at (x, y). Kept as the call-site
		shim so the 13 inner-label draws don't have to be rewired; flip the
		body back to the halo loop if we ever want it again."""
		if not text:
			return
		self.draw.text(xy, text, fill=fill, font=font)


	def drawPlanets(self, chrt, pshift, rPlanet, rRetr, outer=False, label_pshift=None, label_yoffs=None):
		(cx, cy) = self.center.Get()
		clrs = (self.options.clrdomicil, self.options.clrexal, self.options.clrperegrin, self.options.clrcasus, self.options.clrexil)
		clrpos = self.options.clrpositions
		if self.bw:
			clrpos = (0,0,0)
		# label_pshift drives the inner deg/min/retro label angle; falls back
		# to pshift so callers that don't pass it keep legacy behavior.
		if label_pshift is None:
			label_pshift = pshift
		# label_yoffs is a per-body radial-inward offset (px) — adjacent inner
		# labels in tight clusters get pushed onto a second radial layer so
		# they don't pixel-overlap their neighbor. Zero everywhere means no
		# stagger.
		if label_yoffs is None:
			label_yoffs = [0.0] * len(pshift)
		skip_planet_detail = bool(getattr(self, 'disable_planet_detail', False))
		body_font = self.fntOuterMorinus if outer else self.fntMorinus
		body_size = self.outerPlanetGlyphSize if outer else self.planetGlyphSize
		for body_id in self._iter_draw_body_ids(chrt):
			lon = self._get_body_lon(chrt, body_id)
			if lon is None:
				continue

			x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon-pshift[body_id]))*rPlanet
			y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon-pshift[body_id]))*rPlanet

			clr = self._get_body_color(chrt, body_id, clrs)

			txtpl = self._get_body_glyph(body_id)

			self.draw.text((x-body_size/2, y-body_size/2), txtpl, fill=clr, font=body_font)
			if skip_planet_detail:
				continue

			region_kind = 'planet' if body_id != planets.Planets.PLANETS_NUM else 'fortune'
			region_id = body_id if body_id != planets.Planets.PLANETS_NUM else 'fortune'
			chart_role = 'outer' if outer else 'primary'
			# Biwheel partner so the inspector can report cross-chart aspects
			# (transit→radix when this body is the transit; radix→transit when
			# it's the radix) instead of the hovered chart's aspects to itself.
			# Single-wheel charts get None and the inspector falls back to the
			# intra-chart aspect matrix.
			partner_chart = None
			if self.chart2 is not None:
				partner_chart = self.chart if outer else self.chart2
			motion_marker = ''
			speed_lon = self._get_body_speed_lon(chrt, body_id)
			station_marker = self._getRadixStationMarker(chrt, body_id)
			if station_marker is not None:
				motion_marker = station_marker
			elif speed_lon is not None and speed_lon <= 0.0:
				motion_marker = 'S'
				if speed_lon < 0.0:
					motion_marker = 'R'
			house_index = None
			try:
				house_index = chrt.houses.getHousePos(lon, self.options, False) + 1
			except Exception:
				house_index = None
			self._register_centered_text_hover_region(
				region_kind,
				region_id,
				txtpl,
				body_font,
				x,
				y,
				chart_role=chart_role,
				priority=40 if not outer else 38,
				data={
					'chart': chrt,
					'partner_chart': partner_chart,
					'planet_index': body_id if body_id != planets.Planets.PLANETS_NUM else None,
					'longitude': lon,
					'display_lon': util.normalize(lon - chrt.ayanamsha) if self.options.ayanamsha != 0 else lon,
					'house_index': house_index,
					'motion_marker': motion_marker,
					'speed_lon': speed_lon,
					'declination': self._get_body_declination(chrt, body_id),
					'colour': clr,
					'title': mtexts.txts['Vertex'] if body_id == common.CHART_OBJECT_VERTEX else None,
				},
			)

			if not outer:
				# Position display
				lon2 = lon
				if self.options.ayanamsha != 0:
					lon2 -= self.chart.ayanamsha
					lon2 = util.normalize(lon2)

				(d, m, s) = util.decToDeg(lon2)

				if self.theme == self.THEME_CLASSIC:
					d = d%chart.Chart.SIGN_DEG

					if self.options.positions:
						wdeg, hdeg = self.draw.textsize(str(d), self.fntDegreeText)
						wmin, hmin = self.draw.textsize((str(m).zfill(2)), self.fntMinuteText)
						x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(self.rPos - label_yoffs[body_id])
						y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(self.rPos - label_yoffs[body_id])
						xdeg = x-wdeg/2
						ydeg = y-hdeg/2
						self._draw_text_haloed((xdeg, ydeg), str(d), fill=clrpos, font=self.fntDegreeText)
						self._draw_text_haloed((xdeg+wdeg, ydeg), (str(m)).zfill(2), fill=clrpos, font=self.fntMinuteText)

					#Retrograde
					if speed_lon is not None:
						if station_marker is not None or speed_lon <= 0.0:
							t = station_marker
							if t is None:
								t = 'S'
								if speed_lon < 0.0:
									t = 'R'

							x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(rRetr - label_yoffs[body_id])
							y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(rRetr - label_yoffs[body_id])

							rfnt = self.fntMotionStation if t in ('SR', 'SD') else self.fntMotionClassic
							motion_offset = self.symbolSize/8
							self._draw_text_haloed((x-motion_offset, y-motion_offset), t, fill=clr, font=rfnt)
				else:
					d, m = util.roundDeg(d%chart.Chart.SIGN_DEG, m, s)

					degtxt = str(d)+self.deg_symbol
					wdeg, hdeg = self.draw.textsize(degtxt, self.fntDegreeText)
					x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(self.rPosDeg - label_yoffs[body_id])
					y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(self.rPosDeg - label_yoffs[body_id])
					xdeg = x-wdeg/2
					ydeg = y-hdeg/2
					self._draw_text_haloed((xdeg, ydeg), degtxt, fill=clrpos, font=self.fntDegreeText)

					mintxt = str(m)+"'"
					wdeg, hdeg = self.draw.textsize(mintxt, self.fntMinuteText)
					x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(self.rPosMin - label_yoffs[body_id])
					y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(self.rPosMin - label_yoffs[body_id])
					xdeg = x-wdeg/2
					ydeg = y-hdeg/2
					self._draw_text_haloed((xdeg, ydeg), (mintxt).zfill(2), fill=clrpos, font=self.fntMinuteText)

					#Retrograde
					if speed_lon is not None:
						rfnt = self.fntMotionCompact
						if station_marker is not None or speed_lon <= 0.0:
							t = station_marker
							if t is None:
								t = 'S'
								if speed_lon < 0.0:
									t = common.common.retr
								rfnt = self.fntMotionCompactRetr
							else:
								rfnt = self.fntMotionStation

							wdeg, hdeg = self.draw.textsize(t, rfnt)
							x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(rRetr - label_yoffs[body_id])
							y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(rRetr - label_yoffs[body_id])
							xdeg = x-wdeg/2
							ydeg = y-hdeg/2

							self._draw_text_haloed((xdeg, ydeg), t, fill=clr, font=rfnt)
			else:
				#Retrograde (outer ring — same in both themes)
				if speed_lon is not None:
					if station_marker is not None or speed_lon <= 0.0:
						t = station_marker
						if t is None:
							t = 'S'
							if speed_lon < 0.0:
								t = 'R'
						rfnt = self.fntOuterMotion
						if station_marker is not None:
							rfnt = self.fntOuterMotionStation
						x = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(rRetr - label_yoffs[body_id])
						y = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon-label_pshift[body_id]))*(rRetr - label_yoffs[body_id])

						motion_offset = self.outerSymbolSize/8 * self._visual_factor('outerMotionOffsetScale')
						self._draw_text_haloed((x-motion_offset, y-motion_offset), t, fill=clr, font=rfnt)


	def drawAspectSymbols(self, click_planet=None):
		(cx, cy) = self.center.Get()

		planet_ids = self.chart.get_visible_aspect_planet_ids(include_chiron=True)
		for idx_i in range(len(planet_ids)):
			i = planet_ids[idx_i]
			force_i = self._click_target_matches_body(click_planet, 'primary', i)
			if i in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes and not force_i:
				continue
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None:
				continue
			for j in planet_ids[idx_i+1:]:
				force_j = self._click_target_matches_body(click_planet, 'primary', j)
				if j in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes and not force_j:
					continue
				if click_planet is not None:
					if not force_i and not force_j:
						continue
				lon2 = self._get_body_lon(self.chart, j)
				if lon2 is None:
					continue
				asp = self._get_planetary_aspect(self.chart, i, j, click_target=click_planet)
				showasp = self._should_show_aspect(asp, lon1, lon2, click_target=click_planet)
				if showasp:
					x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
					y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
					x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp
					y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp

					self._draw_aspect_symbol(
						(x1+x2)/2, (y1+y2)/2, asp,
						body_a=self._planet_body_info(self.chart, i),
						body_b=self._planet_body_info(self.chart, j),
					)

		for i in planet_ids:
			if i in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes:
				continue
			if click_planet is not None:
				if not self._click_target_matches_body(click_planet, 'primary', i):
					continue
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None:
				continue
			for j in range(2):
					asp = self._get_ascmc_aspect(self.chart, j, i, click_target=click_planet)
					lon2 = self.chart.houses.ascmc[j]
					showasp = self._should_show_aspect(asp, lon1, lon2, click_target=click_planet)
					if showasp:
						x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
						y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
						x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-self.chart.houses.ascmc[j]))*self.rAspAscMC
						y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-self.chart.houses.ascmc[j]))*self.rAspAscMC

						self._draw_aspect_symbol(
							(x1+x2)/2, (y1+y2)/2, asp,
							body_a=self._planet_body_info(self.chart, i),
							body_b=self._angle_body_info(self.chart, j),
						)


	def drawLoFAspectSymbols(self, click_planet=None):
		(cx, cy) = self.center.Get()

		force_fortune = self._click_target_matches_fortune(click_planet, 'primary')
		if not self.options.showlof and not force_fortune:
			return
		lon2 = self.chart.fortune.fortune[fortune.Fortune.LON]
		for i in self.chart.get_visible_aspect_planet_ids(include_chiron=True):
			force_body = self._click_target_matches_body(click_planet, 'primary', i)
			if i in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes and not force_body:
				continue
			if click_planet is not None and not force_body and not force_fortune:
				continue
			asp = self._get_lof_aspect(self.chart, i, click_target=click_planet)
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None:
				continue
			showasp = self._should_show_aspect(asp, lon1, lon2, click_target=click_planet)
			if showasp:
				x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
				y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
				x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-self.chart.fortune.fortune[fortune.Fortune.LON]))*self.rAsp
				y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-self.chart.fortune.fortune[fortune.Fortune.LON]))*self.rAsp

				self._draw_aspect_symbol(
					(x1+x2)/2, (y1+y2)/2, asp,
					body_a=self._planet_body_info(self.chart, i),
					body_b=self._fortune_body_info(self.chart),
				)

	def drawVertexAspectSymbols(self, click_planet=None):
		(cx, cy) = self.center.Get()

		force_vertex = self._click_target_matches_vertex(click_planet, 'primary')
		if not self.options.showvertex and not force_vertex:
			return
		lon2 = self.chart.houses.ascmc[houses.Houses.VERTEX]
		for i in self.chart.get_visible_aspect_planet_ids(include_chiron=True):
			force_body = self._click_target_matches_body(click_planet, 'primary', i)
			if i in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes and not force_body:
				continue
			if click_planet is not None and not force_body and not force_vertex:
				continue
			asp = self._get_point_aspect(self.chart, i, lon2, click_target=click_planet)
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None:
				continue
			showasp = self._should_show_aspect(asp, lon1, lon2, click_target=click_planet)
			if showasp:
				x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
				y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
				x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp
				y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp

				self._draw_aspect_symbol(
					(x1+x2)/2, (y1+y2)/2, asp,
					body_a=self._planet_body_info(self.chart, i),
					body_b=self._vertex_body_info(self.chart),
				)

	def drawClickedPointAspectSymbols(self, click_planet=None):
		if self._click_target_matches_vertex(click_planet, 'primary'):
			return
		lon2 = self._click_target_point_lon(click_planet, 'primary')
		if lon2 is None:
			return

		(cx, cy) = self.center.Get()
		for i in self.chart.get_visible_aspect_planet_ids(include_chiron=True):
			asp = self._get_point_aspect(self.chart, i, lon2, click_target=click_planet)
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None or not self._should_show_aspect(asp, lon1, lon2, click_target=click_planet):
				continue
			x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
			y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
			x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp
			y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp

			self._draw_aspect_symbol(
				(x1+x2)/2, (y1+y2)/2, asp,
				body_a=self._planet_body_info(self.chart, i),
				body_b=self._point_body_info(lon2),
			)


	# Fuckin' PIL can't draw a dashed line
	def drawAspectLines(self, click_planet=None):
		(cx, cy) = self.center.Get()

		planet_ids = self.chart.get_visible_aspect_planet_ids(include_chiron=True)
		for idx_i in range(len(planet_ids)):
			i = planet_ids[idx_i]
			force_i = self._click_target_matches_body(click_planet, 'primary', i)
			if i in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes and not force_i:
				continue
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None:
				continue
			for j in planet_ids[idx_i+1:]:
				force_j = self._click_target_matches_body(click_planet, 'primary', j)
				if j in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes and not force_j:
					continue
				if click_planet is not None:
					if not force_i and not force_j:
						continue
				lon2 = self._get_body_lon(self.chart, j)
				if lon2 is None:
					continue
				asp = self._get_planetary_aspect(self.chart, i, j, click_target=click_planet)
				showasp = self._should_show_aspect(asp, lon1, lon2, click_target=click_planet)
				if showasp:
					x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
					y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
					x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp
					y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp

					self._draw_aspect_line(
						x1, y1, x2, y2, asp, self.isExact(asp.exact, lon1, lon2),
						body_a=self._planet_body_info(self.chart, i),
						body_b=self._planet_body_info(self.chart, j),
					)


		for i in planet_ids:
			if i in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes:
				continue
			if click_planet is not None:
				if not self._click_target_matches_body(click_planet, 'primary', i):
					continue
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None:
				continue
			for j in range(2):
					asp = self._get_ascmc_aspect(self.chart, j, i, click_target=click_planet)
					lon2 = self.chart.houses.ascmc[j]
					showasp = self._should_show_aspect(asp, lon1, lon2, click_target=click_planet)
					if showasp:
						x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
						y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
						x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-self.chart.houses.ascmc[j]))*self.rAspAscMC
						y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-self.chart.houses.ascmc[j]))*self.rAspAscMC

						self._draw_aspect_line(
							x1, y1, x2, y2, asp, self.isExact(asp.exact, lon1, lon2),
							body_a=self._planet_body_info(self.chart, i),
							body_b=self._angle_body_info(self.chart, j),
						)

	def drawLoFAspectLines(self, click_planet=None):
		(cx, cy) = self.center.Get()

		force_fortune = self._click_target_matches_fortune(click_planet, 'primary')
		if not self.options.showlof and not force_fortune:
			return
		lon2 = self.chart.fortune.fortune[fortune.Fortune.LON]
		for i in self.chart.get_visible_aspect_planet_ids(include_chiron=True):
			force_body = self._click_target_matches_body(click_planet, 'primary', i)
			if i in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes and not force_body:
				continue
			if click_planet is not None and not force_body and not force_fortune:
				continue
			asp = self._get_lof_aspect(self.chart, i, click_target=click_planet)
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None:
				continue
			showasp = self._should_show_aspect(asp, lon1, lon2, click_target=click_planet)
			if showasp:
				x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
				y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
				x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-self.chart.fortune.fortune[fortune.Fortune.LON]))*self.rAsp
				y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-self.chart.fortune.fortune[fortune.Fortune.LON]))*self.rAsp

				self._draw_aspect_line(
					x1, y1, x2, y2, asp, self.isExact(asp.exact, lon1, lon2),
					body_a=self._planet_body_info(self.chart, i),
					body_b=self._fortune_body_info(self.chart),
				)

	def drawVertexAspectLines(self, click_planet=None):
		(cx, cy) = self.center.Get()

		force_vertex = self._click_target_matches_vertex(click_planet, 'primary')
		if not self.options.showvertex and not force_vertex:
			return
		lon2 = self.chart.houses.ascmc[houses.Houses.VERTEX]
		for i in self.chart.get_visible_aspect_planet_ids(include_chiron=True):
			force_body = self._click_target_matches_body(click_planet, 'primary', i)
			if i in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.aspectstonodes and not force_body:
				continue
			if click_planet is not None and not force_body and not force_vertex:
				continue
			asp = self._get_point_aspect(self.chart, i, lon2, click_target=click_planet)
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None:
				continue
			showasp = self._should_show_aspect(asp, lon1, lon2, click_target=click_planet)
			if showasp:
				x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
				y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
				x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp
				y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp

				self._draw_aspect_line(
					x1, y1, x2, y2, asp, self.isExact(asp.exact, lon1, lon2),
					body_a=self._planet_body_info(self.chart, i),
					body_b=self._vertex_body_info(self.chart),
				)

	def drawClickedPointAspectLines(self, click_planet=None):
		if self._click_target_matches_vertex(click_planet, 'primary'):
			return
		lon2 = self._click_target_point_lon(click_planet, 'primary')
		if lon2 is None:
			return

		(cx, cy) = self.center.Get()
		for i in self.chart.get_visible_aspect_planet_ids(include_chiron=True):
			asp = self._get_point_aspect(self.chart, i, lon2, click_target=click_planet)
			lon1 = self._get_body_lon(self.chart, i)
			if lon1 is None or not self._should_show_aspect(asp, lon1, lon2, click_target=click_planet):
				continue
			x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
			y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon1))*self.rAsp
			x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp
			y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon2))*self.rAsp

			self._draw_aspect_line(
				x1, y1, x2, y2, asp, self.isExact(asp.exact, lon1, lon2),
				body_a=self._planet_body_info(self.chart, i),
				body_b=self._point_body_info(lon2),
			)


	def _is_interchart_planet_visible(self, planet_idx):
		if planet_idx == astrology.SE_URANUS and not self.options.transcendental[chart.Chart.TRANSURANUS]:
			return False
		if planet_idx == astrology.SE_NEPTUNE and not self.options.transcendental[chart.Chart.TRANSNEPTUNE]:
			return False
		if planet_idx == astrology.SE_PLUTO and not self.options.transcendental[chart.Chart.TRANSPLUTO]:
			return False
		if planet_idx == astrology.SE_CHIRON and not getattr(self.options, 'showchiron', True):
			return False
		if (planet_idx == astrology.SE_MEAN_NODE or planet_idx == astrology.SE_TRUE_NODE) and (not self.options.shownodes or not self.options.aspectstonodes):
			return False
		return True


	def _click_aspect_enabled_vector(self, click_target):
		if not self._click_target_active(click_target):
			return None
		return [self._click_aspect_type_enabled(i) for i in range(chart.Chart.ASPECT_NUM)]

	def getInterChartAspects(self, click_planet=None):
		if self.chart2 == None:
			return []
		return interchartaspects.calc_planetary_interchart_aspects(
			self.chart,
			self.chart2,
			self.options,
			enabled_aspects=self._click_aspect_enabled_vector(click_planet),
			traditional_filter=self._click_traditional_filter_enabled(click_planet),
		)


	def drawInterChartAspectMarkers(self, aspect_list, click_planet=None):
		if not aspect_list:
			return

		(cx, cy) = self.center.Get()
		clr = (0,0,0)
		if not self.bw:
			clr = self.options.clrframe
		w = self._medium_width()
		self.bdc.SetPen(wx.Pen(clr, w))

		base_asc = self._rotation_asc()
		outer_lons = []
		for outer_idx, inner_idx, asp in aspect_list:
			if click_planet is not None:
				if not (self._click_target_matches_body(click_planet, 'primary', inner_idx) or self._click_target_matches_body(click_planet, 'outer', outer_idx)):
					continue
			if not self._is_interchart_planet_visible(outer_idx) or not self._is_interchart_planet_visible(inner_idx):
				continue
			outer_lon = self._get_body_lon(self.chart2, outer_idx)
			if outer_lon is None:
				continue
			outer_lons.append(round(outer_lon, 6))

		for outer_lon in sorted(set(outer_lons)):
			x1 = cx+math.cos(math.pi+math.radians(base_asc-outer_lon))*self.rAsp
			y1 = cy+math.sin(math.pi+math.radians(base_asc-outer_lon))*self.rAsp
			x2 = cx+math.cos(math.pi+math.radians(base_asc-outer_lon))*self.rLLine2
			y2 = cy+math.sin(math.pi+math.radians(base_asc-outer_lon))*self.rLLine2
			self.bdc.DrawLine(x1, y1, x2, y2)


	def drawInterChartAspectLines(self, aspect_list=None, click_planet=None):
		if self.chart2 == None:
			return
		if aspect_list is None:
			aspect_list = self.getInterChartAspects()

		(cx, cy) = self.center.Get()
		base_asc = self._rotation_asc()
		aspect_radius = self.rAsp
		for outer_idx, inner_idx, asp in aspect_list:
			if click_planet is not None:
				if not (self._click_target_matches_body(click_planet, 'primary', inner_idx) or self._click_target_matches_body(click_planet, 'outer', outer_idx)):
					continue
			if not self._is_interchart_planet_visible(outer_idx) or not self._is_interchart_planet_visible(inner_idx):
				continue

			inner_lon = self._get_body_lon(self.chart, inner_idx)
			outer_lon = self._get_body_lon(self.chart2, outer_idx)
			if inner_lon is None or outer_lon is None:
				continue
			x1 = cx+math.cos(math.pi+math.radians(base_asc-inner_lon))*aspect_radius
			y1 = cy+math.sin(math.pi+math.radians(base_asc-inner_lon))*aspect_radius
			x2 = cx+math.cos(math.pi+math.radians(base_asc-outer_lon))*aspect_radius
			y2 = cy+math.sin(math.pi+math.radians(base_asc-outer_lon))*aspect_radius

			self._draw_aspect_line(
				x1, y1, x2, y2, asp, asp.exact,
				body_a=self._planet_body_info(self.chart, inner_idx, role='primary'),
				body_b=self._planet_body_info(self.chart2, outer_idx, role='outer'),
			)


	def drawInterChartAspectSymbols(self, aspect_list=None, click_planet=None):
		if self.chart2 == None:
			return
		if aspect_list is None:
			aspect_list = self.getInterChartAspects(click_planet=click_planet)

		(cx, cy) = self.center.Get()
		base_asc = self._rotation_asc()
		aspect_radius = self.rAsp
		for outer_idx, inner_idx, asp in aspect_list:
			if click_planet is not None:
				if not (self._click_target_matches_body(click_planet, 'primary', inner_idx) or self._click_target_matches_body(click_planet, 'outer', outer_idx)):
					continue
			if not self._is_interchart_planet_visible(outer_idx) or not self._is_interchart_planet_visible(inner_idx):
				continue

			inner_lon = self._get_body_lon(self.chart, inner_idx)
			outer_lon = self._get_body_lon(self.chart2, outer_idx)
			if inner_lon is None or outer_lon is None:
				continue
			x1 = cx+math.cos(math.pi+math.radians(base_asc-inner_lon))*aspect_radius
			y1 = cy+math.sin(math.pi+math.radians(base_asc-inner_lon))*aspect_radius
			x2 = cx+math.cos(math.pi+math.radians(base_asc-outer_lon))*aspect_radius
			y2 = cy+math.sin(math.pi+math.radians(base_asc-outer_lon))*aspect_radius

			self._draw_aspect_symbol(
				(x1+x2)/2, (y1+y2)/2, asp,
				body_a=self._planet_body_info(self.chart, inner_idx, role='primary'),
				body_b=self._planet_body_info(self.chart2, outer_idx, role='outer'),
			)


	def drawPlanetaryDayAndHour(self):
		# 라벨 색(텍스트 기본색)은 유지, 행성 기호만 사용자 색 적용
		clr_lbl = self.options.clrtexts
		if self.bw:
			clr_lbl = (0,0,0)

		# 외측 차트가 있으면 외측 차트 기준으로 요일/시주 계산
		C = self.chart2 if self.chart2 is not None else self.chart

		# 요일 → 행성 인덱스 매핑 (Mon=0 … Sun=6)
		ar = (1, 4, 2, 5, 3, 6, 0)

		xR = self.w - self.w/25  # 오른쪽 정렬 기준(좌측 여백과 대칭)
		y  = self.h/25
		size = self.symbolSize/4*3

		# Planetary Hours 재계산: 리턴(GMT)이어도 '현지 기준' 일출/일몰로 강제
		try:
			# 기준 차트
			# C = self.chart2 if self.chart2 is not None else self.chart  # (이미 위에서 계산됨)

			# 경/위도(부호 포함)
			lon = C.place.deglon + C.place.minlon/60.0
			if not C.place.east:
				lon *= -1
			lat = C.place.deglat + C.place.minlat/60.0
			if not C.place.north:
				lat *= -1

			# tz_hours 결정
			if C.time.zt == chart.Time.ZONE:
				tz_hours = (1 if C.time.plus else -1) * (C.time.zh + C.time.zm/60.0) + (1.0 if getattr(C.time, 'daylightsaving', False) else 0.0)
			elif C.time.zt == chart.Time.LOCALMEAN:
				tz_hours = lon / 15.0
			elif C.time.zt == chart.Time.LOCALAPPARENT:
				ret, te, serr = astrology.swe_time_equ(C.time.jd)  # te: day 단위
				tz_hours = (lon / 15.0) + te*24.0
			else:
				# GREENWICH (리턴 차트 기본) → LMT로 보정해서 현지 일출/일몰 확보
				tz_hours = lon / 15.0

			# 현지 요일(월=0 … 일=6), JD 기반
			offs = float(tz_hours) / 24.0
			jd_local = C.time.jd + offs
			weekday = int(math.floor(jd_local + 0.5)) % 7

			# Planetary Hours 계산/갱신
			ph_signature = (
				round(float(C.time.jd), 6),
				round(float(lon), 6),
				round(float(lat), 6),
				round(float(getattr(C.place, 'altitude', 0.0)), 2),
				int(weekday),
				round(float(tz_hours), 6),
			)
			if getattr(C.time, 'ph', None) is None or getattr(C.time, '_ph_signature', None) != ph_signature:
				C.time.ph = hours.PlanetaryHours(lon, lat, C.place.altitude, weekday, C.time.jd, tz_hours)
				C.time._ph_signature = ph_signature
		except Exception:
			# 실패 시 기존 로직으로 폴백
			if getattr(C.time, 'ph', None) is None:
				try:
					C.time.calcPHs(C.place)
				except Exception:
					return

		if getattr(C.time, 'ph', None) is None:
			return

		# 일주/시주 인덱스
		idx_day  = ar[C.time.ph.weekday]
		idx_hour = C.time.ph.planetaryhour

		# 사용자 행성색 적용 (가능할 때만)
		if (not self.bw) and getattr(self.options, 'useplanetcolors', False):
			try:
				clr_day = self.options.clrindividual[idx_day]
			except Exception:
				clr_day = clr_lbl
			try:
				clr_hour = self.options.clrindividual[idx_hour]
			except Exception:
				clr_hour = clr_lbl

		else:
			if self.bw:
				clr_day  = (0,0,0)
				clr_hour = (0,0,0)
			else:
				pal = (self.options.clrdomicil,
					   self.options.clrexal,
					   self.options.clrperegrin,
					   self.options.clrcasus,
					   self.options.clrexil)
				try:
					dign_day = C.dignity(idx_day)
					clr_day  = pal[dign_day]
				except Exception:
					clr_day = clr_lbl
				try:
					dign_hour = C.dignity(idx_hour)
					clr_hour  = pal[dign_hour]
				except Exception:
					clr_hour = clr_lbl

		# 출력
		glyph_day  = common.common.Planets[idx_day]
		glyph_hour = common.common.Planets[idx_hour]
		icon_font = self.fntSmallMorinus
		label_font = self.fntInfoLabel

		w_day,  h_icon_day  = icon_font.getsize(glyph_day)
		w_hour, h_icon_hour = icon_font.getsize(glyph_hour)
		w_lbl_day, _  = label_font.getsize(mtexts.txts['Day'])
		w_lbl_hour, _ = label_font.getsize(mtexts.txts['Hour'])
		_,      h_label     = label_font.getsize("Ag")

		line_h = int(max(h_icon_day, h_icon_hour, h_label) * 1.1)
		pad_x  = int(self.symbolSize * 0.25)
		w_icon = max(w_day, w_hour)
		# 각 줄을 우측 정렬: (아이콘 + 패딩 + 라벨)의 오른쪽 끝이 xR에 맞게
		x_day  = xR - (w_day  + pad_x + w_lbl_day)
		x_hour = xR - (w_hour + pad_x + w_lbl_hour)
		# 1행 (일주)
		self.draw.text((x_day, y), glyph_day, fill=clr_day, font=icon_font)
		self.draw.text((x_day + w_day + pad_x, y), mtexts.txts['Day'],  fill=clr_lbl, font=label_font)

		# 2행 (시주)
		y2 = y + line_h
		self.draw.text((x_hour, y2), glyph_hour, fill=clr_hour, font=icon_font)
		self.draw.text((x_hour + w_hour + pad_x, y2), mtexts.txts['Hour'], fill=clr_lbl, font=label_font)

	def _getOverlayPlanetColor(self, chrt, planet_idx, fallback):
		if (not self.bw) and getattr(self.options, 'useplanetcolors', False):
			try:
				color_idx = min(common.common.get_planet_color_index(planet_idx), len(self.options.clrindividual)-1)
				return self.options.clrindividual[color_idx]
			except Exception:
				return fallback

		if self.bw:
			return (0,0,0)

		if planet_idx == astrology.SE_CHIRON:
			return self.options.clrperegrin

		pal = (self.options.clrdomicil,
			   self.options.clrexal,
			   self.options.clrperegrin,
			   self.options.clrcasus,
			   self.options.clrexil)
		try:
			return pal[chrt.dignity(planet_idx)]
		except Exception:
			return fallback

	def _iter_draw_body_ids(self, chrt):
		body_ids = common.common.get_visible_chart_planet_ids(chrt, self.options, include_descnode=True, include_chiron=True)
		if self.options.showlof:
			body_ids.append(planets.Planets.PLANETS_NUM)
		if getattr(self.options, 'showvertex', False):
			body_ids.append(common.CHART_OBJECT_VERTEX)
		return body_ids

	def _get_body_obj(self, chrt, body_id):
		if body_id in (planets.Planets.PLANETS_NUM, common.CHART_OBJECT_VERTEX):
			return None
		return common.common.get_chart_planet(chrt, body_id)

	def _get_body_glyph(self, body_id):
		if body_id == planets.Planets.PLANETS_NUM:
			return common.common.fortune
		if body_id == common.CHART_OBJECT_VERTEX:
			return common.common.get_planet_glyph(common.CHART_OBJECT_VERTEX)
		return common.common.get_planet_glyph(body_id)

	def _get_body_lon(self, chrt, body_id):
		if body_id == planets.Planets.PLANETS_NUM:
			return chrt.fortune.fortune[fortune.Fortune.LON]
		if body_id == common.CHART_OBJECT_VERTEX:
			return chrt.houses.ascmc[houses.Houses.VERTEX]
		obj = self._get_body_obj(chrt, body_id)
		if obj is None:
			return None
		return obj.data[planets.Planet.LONG]

	def _get_body_speed_lon(self, chrt, body_id):
		if body_id in (planets.Planets.PLANETS_NUM, common.CHART_OBJECT_VERTEX):
			return None
		obj = self._get_body_obj(chrt, body_id)
		if obj is None:
			return None
		return obj.data[planets.Planet.SPLON]

	def _get_body_declination(self, chrt, body_id):
		if body_id in (planets.Planets.PLANETS_NUM, common.CHART_OBJECT_VERTEX):
			return None
		obj = self._get_body_obj(chrt, body_id)
		if obj is None:
			return None
		return obj.dataEqu[planets.Planet.DECLEQU]

	def _get_body_color(self, chrt, body_id, palette):
		if self.bw:
			return (0,0,0)
		if body_id == planets.Planets.PLANETS_NUM:
			if self.options.useplanetcolors:
				return self.options.clrindividual[min(astrology.SE_PLUTO+2, len(self.options.clrindividual)-1)]
			return self.options.clrperegrin
		if body_id == common.CHART_OBJECT_VERTEX:
			return self.options.clrperegrin
		if self.options.useplanetcolors:
			color_idx = min(common.common.get_planet_color_index(body_id), len(self.options.clrindividual)-1)
			return self.options.clrindividual[color_idx]
		if body_id == astrology.SE_CHIRON:
			return self.options.clrperegrin
		try:
			return palette[chrt.dignity(body_id)]
		except Exception:
			return self.options.clrperegrin

	def _getCurrentLordOfYear(self):
		if getattr(self.chart, 'solar_average_hide_overlay_info', False):
			return None
		radix = getattr(self, 'radix', None)
		if radix is None and self.chart is not None and self.chart.htype == chart.Chart.RADIX:
			radix = self.chart
		if radix is None:
			return None

		try:
			target_chart = self.chart2 if self.chart2 is not None else self.chart
			if target_chart is None:
				return None

			data = lordofyear.get_lord_of_year(
				radix,
				target_chart,
				self.options,
				getattr(self, 'display_datetime', None),
			)
			if data is None:
				return None
			sign_idx, ruler_idx = data

			signs = common.common.Signs1
			if not self.options.signs:
				signs = common.common.Signs2

			return (signs[sign_idx], common.common.Planets[ruler_idx], ruler_idx)
		except Exception:
			return None

	def _getCurrentTermLord(self):
		if getattr(self.chart, 'solar_average_hide_overlay_info', False):
			return None
		radix = getattr(self, 'radix', None)
		if radix is None and self.chart is not None and self.chart.htype == chart.Chart.RADIX:
			radix = self.chart
		if radix is None:
			return None
		try:
			target_chart = self.chart2 if self.chart2 is not None else self.chart
			if target_chart is None:
				return None
			data = lordofyear.get_term_lord(
				radix,
				target_chart,
				self.options,
				getattr(self, 'display_datetime', None),
			)
			if data is None:
				return None
			sign_idx, ruler_idx = data
			signs = common.common.Signs1
			if not self.options.signs:
				signs = common.common.Signs2
			return (signs[sign_idx], common.common.Planets[ruler_idx], ruler_idx)
		except Exception:
			return None

	def _shouldDrawPlanetaryDayHour(self):
		if getattr(self.chart, 'solar_average_hide_overlay_info', False):
			return False
		return self.options.planetarydayhour and self.chart.htype != chart.Chart.PROFECTION

	def _overlay_render_mode(self):
		mode = getattr(self, 'overlay_render_mode', None)
		if mode in ('full', 'deferred', 'step_fast'):
			return mode
		if bool(getattr(self, 'defer_expensive_overlay', False)):
			return 'deferred'
		return 'full'

	def _supports_radix_signals(self, chrt):
		return chrt is not None

	def _radix_overlay_source_chart(self):
		if self.chart2 is None and self.chart is not None and getattr(self.chart, 'htype', None) == chart.Chart.PROFECTION:
			display_dt = getattr(self, 'display_datetime', None)
			base_time = getattr(self.chart, 'time', None)
			place = getattr(self.chart, 'place', None)
			if display_dt is not None and base_time is not None and place is not None:
				try:
					y, m, d, h, mi, s = [int(v) for v in display_dt[:6]]
					time_obj = chart.Time(
						y, m, d, h, mi, s,
						base_time.bc, base_time.cal, base_time.zt,
						base_time.plus, base_time.zh, base_time.zm, base_time.daylightsaving,
						place, False,
						tzid=getattr(base_time, 'tzid', ''),
						tzauto=getattr(base_time, 'tzauto', False),
					)
					return types.SimpleNamespace(time=time_obj, place=place, htype=self.chart.htype)
				except Exception:
					pass
		if self.chart2 is None and self.chart is not None:
			return self.chart
		return getattr(self, 'radix', None)

	def _getRadixOverlayRows(self, include_phasis=True):
		if getattr(self.chart, 'solar_average_hide_overlay_info', False):
			return []
		if self.chart2 is not None:
			return []
		radix = self._radix_overlay_source_chart()
		if not self._supports_radix_signals(radix):
			return []
		try:
			if not include_phasis:
				return radixsignals.get_radix_signal_display_rows(
					radix,
					options=self.options,
				)
			return radixsignals.get_radix_overlay_display_rows(
				radix,
				phasis_mode=int(getattr(self.options, 'phasismode', 0)),
				cazimi_mode=int(getattr(self.options, 'cazimimode', 0)),
				options=self.options,
			)
		except Exception:
			return []

	def _getRadixStationMarker(self, chrt, planet_idx):
		if self.chart2 is not None:
			return None
		if not self._supports_radix_signals(chrt):
			return None
		try:
			return radixsignals.get_station_marker(chrt, planet_idx, within_days=1.0, options=self.options)
		except Exception:
			return None

	def drawOverlayInfoBlock(self):
		render_mode = self._overlay_render_mode()
		info = self._getCurrentLordOfYear()
		term_info = self._getCurrentTermLord() if render_mode != 'step_fast' else None
		if render_mode == 'step_fast':
			rows = []
		else:
			rows = self._getRadixOverlayRows(include_phasis=(render_mode == 'full'))
		pd_exact = self._getPDExactOverlayRow()
		draw_dayhour = self._shouldDrawPlanetaryDayHour()
		if info is None and term_info is None and not rows and pd_exact is None and not draw_dayhour:
			return

		clr_lbl = self.options.clrtexts
		if self.bw:
			clr_lbl = (0,0,0)

		# Overlay-anchored margin — the host paints these in panel space
		# (see `_emit_overlay_label`), so anchor the top-right block to the
		# panel corner with a small fixed margin, not the legacy
		# wheel-bbox-relative ``self.w/25``.
		_overlay_margin = self._overlay_label_margin()
		xR = self.w - _overlay_margin
		y = _overlay_margin

		icon_font = self.fntOverlayIcon
		text_font = self.fntOverlayLabel
		offset_font = text_font
		aspect_font = self.fntOverlayIcon
		_, h_text = text_font.getsize("Ag")
		h_icon = icon_font.getsize(common.common.Planets[astrology.SE_JUPITER])[1]
		_, h_offset = offset_font.getsize("Ag")
		line_h = int(max(h_text, h_icon, h_offset) * self.OVERLAY_ROW_HEIGHT_FACTOR)
		gap_after_dayhour = int(line_h * self.OVERLAY_GAP_AFTER_DAYHOUR)
		gap_between_groups = int(line_h * self.OVERLAY_GAP_BETWEEN_GROUPS)

		gap_lg = max(2, int(self.symbolSize * self.OVERLAY_GAP_LABEL_GLYPH))
		gap_gg = max(1, int(self.symbolSize * self.OVERLAY_GAP_GLYPH_GLYPH))
		gap_go = max(2, int(self.symbolSize * self.OVERLAY_GAP_GLYPH_OFFSET))

		def _row_y(base_y, txt, fnt):
			return base_y + int((line_h - fnt.getsize(txt)[1]) / 2.0)

		# --- Collect Day/Hour data ---
		dayhour_rows = []
		if draw_dayhour:
			C = self.chart2 if self.chart2 is not None else self.chart
			if getattr(C.time, 'ph', None) is not None:
				ar = (1, 4, 2, 5, 3, 6, 0)
				idx_day = ar[C.time.ph.weekday]
				idx_hour = C.time.ph.planetaryhour
				glyph_day = common.common.Planets[idx_day]
				glyph_hour = common.common.Planets[idx_hour]
				clr_day = self._getOverlayPlanetColor(C, idx_day, clr_lbl)
				clr_hour = self._getOverlayPlanetColor(C, idx_hour, clr_lbl)
				dayhour_rows.append((mtexts.txts['Day'], glyph_day, clr_day))
				dayhour_rows.append((mtexts.txts['Hour'], glyph_hour, clr_hour))

		# --- Collect header rows (Term lord, LOY) ---
		header_rows = []
		if term_info is not None:
			sign_glyph, ruler_glyph, ruler_idx = term_info
			clr_ruler = self._getOverlayPlanetColor(getattr(self, 'radix', None) or self.chart, ruler_idx, clr_lbl)
			header_rows.append(('Term lord', sign_glyph, ruler_glyph, clr_ruler))
		if info is not None:
			sign_glyph, ruler_glyph, ruler_idx = info
			clr_ruler = self._getOverlayPlanetColor(getattr(self, 'radix', None) or self.chart, ruler_idx, clr_lbl)
			header_rows.append(('Lord of the year', sign_glyph, ruler_glyph, clr_ruler))

		# --- Pre-measure all groups to find shared left edge ---
		dh_total = 0
		dh_max_lbl = dh_max_glyph = 0
		if dayhour_rows:
			dh_max_lbl = max(text_font.getsize(r[0])[0] for r in dayhour_rows)
			dh_max_glyph = max(icon_font.getsize(r[1])[0] for r in dayhour_rows)
			dh_total = dh_max_lbl + gap_lg + dh_max_glyph

		hdr_total = 0
		hdr_max_lbl = hdr_max_sign = hdr_max_ruler = 0
		if header_rows:
			hdr_max_lbl = max(text_font.getsize(r[0])[0] for r in header_rows)
			hdr_max_sign = max(icon_font.getsize(r[1])[0] for r in header_rows)
			hdr_max_ruler = max(icon_font.getsize(r[2])[0] for r in header_rows)
			hdr_total = hdr_max_lbl + gap_lg + hdr_max_sign + gap_gg + hdr_max_ruler

		sig_data = []
		sig_total = 0
		sig_max_lbl = sig_max_glyph = sig_max_off = 0
		if rows:
			for planet_idx, label, offset_text in rows:
				if planet_idx is None:
					glyph = ''
					clr_planet = clr_lbl
				else:
					glyph = common.common.get_planet_glyph(planet_idx)
					clr_planet = self._getOverlayPlanetColor(self.chart, planet_idx, clr_lbl)
				sig_data.append((label, glyph, offset_text, clr_planet))
			sig_max_lbl = max(text_font.getsize(r[0])[0] for r in sig_data)
			sig_max_glyph = max(icon_font.getsize(r[1])[0] for r in sig_data)
			sig_max_off = max(offset_font.getsize(r[2])[0] for r in sig_data)
			sig_total = sig_max_lbl + gap_lg + sig_max_glyph + gap_go + sig_max_off

		# --- Shared column grid across all groups ---
		# Col layout: label | gap_lg | glyph1 (sign/planet) | gap_gg | glyph2/offset
		# Max label width across all groups
		all_lbl_widths = []
		if dayhour_rows:
			all_lbl_widths.append(dh_max_lbl)
		if header_rows:
			all_lbl_widths.append(hdr_max_lbl)
		if sig_data:
			all_lbl_widths.append(sig_max_lbl)
		if not all_lbl_widths:
			all_lbl_widths.append(0)
		global_max_lbl = max(all_lbl_widths)

		# Max first-glyph width (Day/Hour glyph, header sign, signal planet)
		all_g1_widths = []
		if dayhour_rows:
			all_g1_widths.append(dh_max_glyph)
		if header_rows:
			all_g1_widths.append(hdr_max_sign)
		if sig_data:
			all_g1_widths.append(sig_max_glyph)
		if not all_g1_widths:
			all_g1_widths.append(0)
		global_max_g1 = max(all_g1_widths)

		# Max second-column width (header ruler, signal offset; Day/Hour has none)
		all_g2_widths = []
		if header_rows:
			all_g2_widths.append(hdr_max_ruler)
		if sig_data:
			all_g2_widths.append(sig_max_off)
		global_max_g2 = max(all_g2_widths) if all_g2_widths else 0

		# Compute positions
		total_w = global_max_lbl + gap_lg + global_max_g1
		if global_max_g2 > 0:
			total_w += gap_gg + global_max_g2
		x_left = xR - total_w
		x_g1 = x_left + global_max_lbl + gap_lg
		x_g2 = x_g1 + global_max_g1 + gap_gg

		# --- Draw Day/Hour rows ---
		if dayhour_rows:
			for lbl, glyph, clr_g in dayhour_rows:
				self._emit_overlay_label('top-right', x_left, _row_y(y, lbl, text_font), lbl, text_font, clr_lbl)
				self._emit_overlay_label('top-right', x_g1, _row_y(y, glyph, icon_font), glyph, icon_font, clr_g)
				y += line_h
			if header_rows:
				y += gap_after_dayhour

		# --- Draw header rows (Term lord, LOY) ---
		if header_rows:
			for label_txt, s_glyph, r_glyph, clr_r in header_rows:
				self._emit_overlay_label('top-right', x_left, _row_y(y, label_txt, text_font), label_txt, text_font, clr_lbl)
				self._emit_overlay_label('top-right', x_g1, _row_y(y, s_glyph, icon_font), s_glyph, icon_font, clr_lbl)
				self._emit_overlay_label('top-right', x_g2, _row_y(y, r_glyph, icon_font), r_glyph, icon_font, clr_r)
				y += line_h

		# --- Signal rows ---
		if sig_data:
			if dayhour_rows or header_rows:
				y += gap_between_groups
			for label, glyph, offset_text, clr_planet in sig_data:
				self._emit_overlay_label('top-right', x_left, _row_y(y, label, text_font), label, text_font, clr_lbl)
				if glyph:
					self._emit_overlay_label('top-right', x_g1, _row_y(y, glyph, icon_font), glyph, icon_font, clr_planet)
				self._emit_overlay_label('top-right', x_g2, _row_y(y, offset_text, offset_font), offset_text, offset_font, clr_lbl)
				y += line_h

		if pd_exact is not None:
			prom_glyph, prom_idx, aspect_txt, sig_glyph, sig_idx, dir_marker, prom_font_kind, asp_font_kind, sig_font_kind, mundane_marker = pd_exact
			prom_font = icon_font if prom_font_kind == 'symbol' else text_font
			sig_font = icon_font if sig_font_kind == 'symbol' else text_font
			asp_font = aspect_font if asp_font_kind == 'symbol' else offset_font
			dir_font = text_font
			w_dir, _ = dir_font.getsize(dir_marker)
			clr_prom = clr_lbl
			clr_sig = clr_lbl
			pd_color_chart = self.chart2 if self.chart2 is not None else self.chart
			if prom_idx is not None:
				clr_prom = self._getOverlayPlanetColor(pd_color_chart, prom_idx, clr_lbl)
			if sig_idx is not None:
				clr_sig = self._getOverlayPlanetColor(pd_color_chart, sig_idx, clr_lbl)

			tokens = [(prom_glyph, prom_font, clr_prom)]
			if aspect_txt != '':
				tokens.append((aspect_txt, asp_font, clr_lbl))
			tokens.append((sig_glyph, sig_font, clr_sig))

			gap_token = max(1, int(self.symbolSize * 0.06))
			gap_dir = max(3, int(self.symbolSize * 0.10))
			gap_mode = max(2, int(self.symbolSize * 0.12))
			token_widths = []
			for txt, fnt, _clr in tokens:
				token_widths.append(fnt.getsize(txt)[0])
			sym_w = sum(token_widths)
			if len(token_widths) > 1:
				sym_w += gap_token * (len(token_widths) - 1)
			w_mode = dir_font.getsize(mundane_marker)[0] if mundane_marker else 0
			total_w = sym_w + gap_dir + w_dir
			if mundane_marker:
				total_w += gap_mode + w_mode
			x = xR - total_w

			for i, (txt, fnt, clr) in enumerate(tokens):
				self._emit_overlay_label('top-right', x, _row_y(y, txt, fnt), txt, fnt, clr)
				x += token_widths[i]
				if i < len(tokens) - 1:
					x += gap_token

			x += gap_dir
			self._emit_overlay_label('top-right', x, _row_y(y, dir_marker, dir_font), dir_marker, dir_font, clr_lbl)
			if mundane_marker:
				x += w_dir + gap_mode
				self._emit_overlay_label('top-right', x, _row_y(y, mundane_marker, dir_font), mundane_marker, dir_font, clr_lbl)

	def _pdObjGlyph(self, obj_id):
		if obj_id is None:
			return '', None
		if 0 <= obj_id < len(common.common.Planets):
			return common.common.Planets[obj_id], obj_id
		if obj_id == primdirs.PrimDir.LOF:
			return common.common.fortune, astrology.SE_MEAN_NODE+1
		if obj_id == primdirs.PrimDir.ASC:
			return mtexts.txts['Asc'], None
		if obj_id == primdirs.PrimDir.MC:
			return mtexts.txts['MC'], None
		if obj_id == primdirs.PrimDir.DESC:
			return mtexts.txts['Dsc'], None
		if obj_id == primdirs.PrimDir.IC:
			return mtexts.txts['IC'], None
		return '?', None

	def _pdAspGlyph(self, asp):
		if asp is None:
			return ''
		if asp == chart.Chart.CONJUNCTIO:
			return ''
		if 0 <= asp < len(common.common.Aspects):
			return common.common.Aspects[asp]
		return ''

	def _pdDirectionMarker(self, direct):
		if direct is None:
			return ''
		return mtexts.txts['Direct'] if direct else mtexts.txts['Converse']

	def _getPDExactOverlayRow(self):
		event = None
		if getattr(self, 'chart2', None) is not None:
			event = getattr(self.chart2, '_pd_exact_event', None)
		if not event:
			event = getattr(self.chart, '_pd_exact_event', None)
		if not event:
			return None
		prom_glyph = event.get('prom_glyph', '')
		sig_glyph = event.get('sig_glyph', '')
		prom_idx = None
		sig_idx = None
		if prom_glyph == '' or sig_glyph == '':
			prom_glyph, prom_idx = self._pdObjGlyph(event.get('prom'))
			sig_glyph, sig_idx = self._pdObjGlyph(event.get('sig'))
		else:
			prom_id = event.get('prom')
			sig_id = event.get('sig')
			if prom_id is not None and 0 <= prom_id < len(common.common.Planets) and prom_glyph == common.common.Planets[prom_id]:
				prom_idx = prom_id
			if sig_id is not None and 0 <= sig_id < len(common.common.Planets) and sig_glyph == common.common.Planets[sig_id]:
				sig_idx = sig_id
		if prom_glyph == '' and sig_glyph == '':
			return None
		dir_marker = event.get('dir_glyph', self._pdDirectionMarker(event.get('direct')))
		aspect_core = event.get('mid_aspect_glyph', '')
		if aspect_core == '':
			promasp = event.get('promasp')
			sigasp = event.get('sigasp')
			if promasp is not None and 0 <= promasp < len(common.common.Aspects):
				aspect_core = common.common.Aspects[promasp]
			elif sigasp is not None and 0 <= sigasp < len(common.common.Aspects):
				aspect_core = common.common.Aspects[sigasp]
		prom_font_kind = event.get('prom_font', 'symbol')
		sig_font_kind = event.get('sig_font', 'symbol')
		asp_font_kind = event.get('aspect_font', 'symbol')
		if sig_glyph == '':
			sig_glyph = '?'
			sig_font_kind = 'text'
		if prom_glyph == '':
			prom_glyph = '?'
			prom_font_kind = 'text'
		if dir_marker == '':
			dir_marker = '-'
		mundane_marker = 'M' if bool(event.get('mundane')) else 'Z'
		return (prom_glyph, prom_idx, aspect_core, sig_glyph, sig_idx, dir_marker, prom_font_kind, asp_font_kind, sig_font_kind, mundane_marker)

	def drawLordOfYear(self):
		info = self._getCurrentLordOfYear()
		if info is None:
			return

		sign_glyph, ruler_glyph, ruler_idx = info
		radix = getattr(self, 'radix', None)
		if radix is None and self.chart is not None and self.chart.htype == chart.Chart.RADIX:
			radix = self.chart

		clr_lbl = self.options.clrtexts
		if self.bw:
			clr_lbl = (0,0,0)
		clr_ruler = self._getOverlayPlanetColor(radix if radix is not None else self.chart, ruler_idx, clr_lbl)

		xR = self.w - self.w/25
		y = self.h/25

		label_font = self.fntInfoLabel
		icon_font = self.fntSmallMorinus
		_, h_label = label_font.getsize("Ag")
		h_icon = icon_font.getsize(ruler_glyph)[1]
		line_h = int(max(h_icon, h_label) * 1.1)
		if self._shouldDrawPlanetaryDayHour():
			y += line_h * 2

		label = 'LOY'
		pad_x = int(self.symbolSize * 0.20)
		w_sign, _ = icon_font.getsize(sign_glyph)
		w_ruler, _ = icon_font.getsize(ruler_glyph)
		w_lbl, _ = label_font.getsize(label)
		x = xR - (w_sign + pad_x + w_ruler + pad_x + w_lbl)

		self.draw.text((x, y), sign_glyph, fill=clr_lbl, font=icon_font)
		self.draw.text((x + w_sign + pad_x, y), ruler_glyph, fill=clr_ruler, font=icon_font)
		self.draw.text((x + w_sign + pad_x + w_ruler + pad_x, y), label, fill=clr_lbl, font=label_font)

	def drawRadixSignals(self):
		rows = self._getRadixOverlayRows()
		if not rows:
			return

		clr_lbl = self.options.clrtexts
		if self.bw:
			clr_lbl = (0,0,0)

		xR = self.w - self.w/25
		y = self.h/25
		label_font = self.fntInfoLabel
		_, h_label = label_font.getsize("Ag")
		h_icon = self.fntSmallMorinus.getsize(common.common.Planets[astrology.SE_MERCURY])[1]
		line_h = int(max(h_icon, h_label) * 1.05)
		_, h_main = self.fntSmallText2.getsize("Ag")
		h_loy = max(self.fntSmallMorinus.getsize(common.common.Planets[astrology.SE_JUPITER])[1], h_main)
		if self._shouldDrawPlanetaryDayHour():
			y += int(h_main * 2.35)
		y += int(h_loy * 1.25)

		pad_x = int(self.symbolSize * 0.10)
		offset_gap = int(self.symbolSize * 0.12)
		max_label = 0
		max_offset = 0
		for _, label, offset_text in rows:
			max_label = max(max_label, label_font.getsize(label)[0])
			max_offset = max(max_offset, label_font.getsize(offset_text)[0])

		x_off = xR - max_offset
		x_lbl = x_off - offset_gap - max_label
		for planet_idx, label, offset_text in rows:
			glyph = common.common.get_planet_glyph(planet_idx)
			clr_planet = self._getOverlayPlanetColor(self.chart, planet_idx, clr_lbl)
			w_glyph, _ = self.fntSmallMorinus.getsize(glyph)
			w_off, _ = label_font.getsize(offset_text)
			x = x_lbl - pad_x - w_glyph
			off_x = x_off + (max_offset - w_off)
			self.draw.text((x, y), glyph, fill=clr_planet, font=self.fntSmallMorinus)
			self.draw.text((x_lbl, y), label, fill=clr_lbl, font=label_font)
			self.draw.text((off_x, y), offset_text, fill=clr_lbl, font=label_font)
			y += line_h

	def _emit_overlay_ring_label(self, bx, by, text, font, color):
		"""Emit a secondary-ring label (fixed star, asteroid, arabic part,
		outer-fortune text) into the overlay layer, painted in panel space
		by the host. Frees the label from bitmap-edge truncation —
		``_fit_outer_word_label_to_bitmap`` clipped long labels at the
		bitmap square's edges, but with the bitmap centered as a square in
		a wider panel, the gutters were inaccessible.

		``(bx, by)`` is the bitmap-space top-left of the text exactly as
		the original ``self.draw.text`` call would have used it; any
		left-hemisphere ``x -= w`` shift is already applied. We store it
		as ``(dx, dy)`` relative to the wheel center, which the host
		translates to ``panel_center + (dx, dy)`` — and panel_center
		equals wheel center because the bitmap is a centered square."""
		wxfont = getattr(font, 'wxfont', None)
		if wxfont is None or not text:
			return
		cx, cy = self.center.Get()
		self.overlay_labels.append({
			'anchor': 'wheel-center',
			'dx': float(bx - cx),
			'dy': float(by - cy),
			'text': str(text),
			'wx_font': wxfont,
			'color': tuple(color),
		})

	def _overlay_label_margin(self):
		"""Pixel margin used by the corner-text drawers when emitting overlay
		labels. Anchors them at ``chartsize/25`` from the panel corner —
		matches the original Morinus legacy proportions, where corner
		labels sit clearly inside the canvas edges rather than hugging
		them. Pair with a sub-100% chart-bitmap size in
		``CentralChartHost.get_chart_size`` so the wheel doesn't fill the
		panel and the labels have visible gutter space to live in."""
		return self.chartsize / 25.0

	def _emit_overlay_label(self, anchor, bx, by, text, font, color):
		"""Convert a bitmap-space ``(bx, by)`` top-left text position into a
		panel-anchored overlay-label item. The host paints these in panel
		space; ``dx``/``dy`` are pixels from the named panel edge to the
		text's top-left corner.

		Anchor maps:
		* ``'top-left'``     → ``dx = bx``,           ``dy = by``
		* ``'top-right'``    → ``dx = self.w - bx``,  ``dy = by``
		* ``'bottom-left'``  → ``dx = bx``,           ``dy = self.h - by``
		* ``'bottom-right'`` → ``dx = self.w - bx``,  ``dy = self.h - by``

		Pre-computing ``dx``/``dy`` in GraphChart (which already measured the
		text width to position it on the bitmap) keeps right-aligned glyphs
		column-aligned regardless of any host-side measurement drift.
		``font`` is the PIL-wrapped font used during layout; the underlying
		``wxfont`` is stored so the host can use it directly."""
		wxfont = getattr(font, 'wxfont', None)
		if wxfont is None or not text:
			return
		if anchor == 'top-left':
			dx, dy = bx, by
		elif anchor == 'top-right':
			dx, dy = self.w - bx, by
		elif anchor == 'bottom-left':
			dx, dy = bx, self.h - by
		elif anchor == 'bottom-right':
			dx, dy = self.w - bx, self.h - by
		else:
			return
		self.overlay_labels.append({
			'anchor': anchor,
			'dx': float(dx),
			'dy': float(dy),
			'text': str(text),
			'wx_font': wxfont,
			'color': tuple(color),
		})

	def drawHousesystemName(self):
		clr = self.options.clrtexts
		if self.bw:
			clr = (0,0,0)

		# 프레임 기준 여백 — overlay-anchored margin (≪ legacy self.w/25)
		# so labels hug the panel corner instead of the wheel-bbox corner.
		margin_x = self._overlay_label_margin()
		margin_y = self._overlay_label_margin()

		# 우측 정렬 기준선
		xR = self.w - margin_x

		# 줄 높이(기존 계수 유지)
		_, h = self.fntBigText.getsize("Ag")
		dy = h * 1.1

		hs_txt  = self.hsystem[self._effective_hsys()]
		aya_on  = (self.options.ayanamsha != 0)

		# 총 라인 수(아야남샤가 있으면 2줄, 없으면 1줄)
		total_lines = 2 if aya_on else 1

		# 하단 블록 높이 = (줄수-1)*줄간격 + 실제 글자높이(h)
		top_y = self.h - margin_y - (((total_lines - 1) * dy) + h)

		# (있으면) 윗줄: 아야남샤 — 우측 정렬
		# Fall back to the full label from mtexts.ayanamshalist (or a
		# generic 'Ayanamsha' string) if a future mode lands beyond the
		# short-label map; otherwise an unknown index would KeyError and
		# take the entire bottom-right block (including the house-system
		# label below) down with it.
		if aya_on:
			fallback = 'Ayanamsha'
			try:
				fallback = mtexts.ayanamshalist[int(self.options.ayanamsha)]
			except (IndexError, ValueError, TypeError):
				pass
			aya_txt = self.ayans.get(self.options.ayanamsha, fallback)
			w_aya, _ = self.fntBigText.getsize(aya_txt)
			self._emit_overlay_label('bottom-right', xR - w_aya, top_y, aya_txt, self.fntBigText, clr)

		# 아랫줄: 하우스시스템 — 우측 정렬
		w_hs, _ = self.fntBigText.getsize(hs_txt)
		y_hs = top_y + (dy if aya_on else 0)
		self._emit_overlay_label('bottom-right', xR - w_hs, y_hs, hs_txt, self.fntBigText, clr)

	def drawChartTimeTopLeft(self):
		_overlay_margin = self._overlay_label_margin()
		if getattr(self.chart, 'is_solar_average', False):
			clr = self.options.clrtexts
			if self.bw:
				clr = (0, 0, 0)
			x = _overlay_margin
			y = _overlay_margin
			age_min = int(getattr(self.chart, 'solar_average_age_min', 0))
			age_max = int(getattr(self.chart, 'solar_average_age_max', age_min))
			label = 'Age %d - %d' % (age_min, age_max)
			self._emit_overlay_label('top-left', x, y, label, self.fntBigText, clr)
			return
		if getattr(self.chart, 'notes', '') == 'Composite chart':
			clr = self.options.clrtexts
			if self.bw:
				clr = (0, 0, 0)
			x = _overlay_margin
			y = _overlay_margin
			name = getattr(self.chart, 'name', '') or ''
			if ' Composite' in name:
				name = name.split(' Composite', 1)[0]
			names = []
			for sep in (' + ', ' - '):
				if sep in name:
					names = [part.strip() for part in name.split(sep, 1) if part.strip()]
					break
			if not names:
				names = [name.strip() or 'Composite']
			_, h = self.fntBigText.getsize("Ag")
			dy = h * 1.1
			for idx, line in enumerate(names[:2]):
				self._emit_overlay_label('top-left', x, y + (dy * idx), line, self.fntBigText, clr)
			return
		# 좌상단: 윗줄 = 날짜(예: 1998.July.23), 아랫줄 = 시간+표준(예: 11:20:24ZN)
		clr = self.options.clrtexts
		if self.bw:
			clr = (0, 0, 0)

		# 위치: 화면 안쪽 여백 — overlay-anchored margin
		x = _overlay_margin
		y = _overlay_margin

		# 줄 간격
		_, h = self.fntBigText.getsize("Ag")
		dy = h * 1.1

		dt = getattr(self, 'display_datetime', None)
		if dt is None:
			dt = (
				self.chart.time.origyear,
				self.chart.time.origmonth,
				self.chart.time.origday,
				self.chart.time.hour,
				self.chart.time.minute,
				self.chart.time.second,
			)
		yv, mv, dv, hv, miv, sv = [int(v) for v in dt]

		# 날짜 문자열 (월은 현지화)
		sign = '-' if self.chart.time.bc else ''
		month_txt = common.common.months[mv - 1]
		date_txt = f"{sign}{yv}.{month_txt}.{str(dv).zfill(2)}"

		# 시간 표기 + 기준(ZN/UT/LC) 현지화
		ztxt = ''
		if self.chart.time.zt == chart.Time.ZONE:
			ztxt = mtexts.txts['ZN']
		elif self.chart.time.zt == chart.Time.LOCALMEAN or self.chart.time.zt == chart.Time.LOCALAPPARENT:
			ztxt = mtexts.txts['LC']
		time_txt = f"{str(hv).zfill(2)}:{str(miv).zfill(2)}:{str(sv).zfill(2)}"
		if ztxt:
			time_txt = f"{time_txt}, {ztxt}"

		# 출력
		self._emit_overlay_label('top-left', x, y,      date_txt, self.fntBigText, clr)
		self._emit_overlay_label('top-left', x, y + dy, time_txt, self.fntBigText, clr)

	def drawChartPlaceBottomLeft(self):
		_overlay_margin = self._overlay_label_margin()
		if getattr(self.chart, 'is_solar_average', False):
			clr = self.options.clrtexts
			if self.bw:
				clr = (0, 0, 0)
			x = _overlay_margin
			_, h = self.fntBigText.getsize('Ag')
			dy = int(h * 1.1)
			y0 = self.h - _overlay_margin - (dy + h)
			label = getattr(self.chart, 'solar_average_footer_label', 'Average')
			self._emit_overlay_label('bottom-left', x, y0 + dy, label, self.fntBigText, clr)
			return
		if getattr(self.chart, 'notes', '') == 'Composite chart':
			clr = self.options.clrtexts
			if self.bw:
				clr = (0, 0, 0)
			x = _overlay_margin
			_, h = self.fntBigText.getsize("Ag")
			dy = h * 1.1
			y0 = self.h - _overlay_margin - (dy + h)
			self._emit_overlay_label('bottom-left', x, y0,      'Composite',   self.fntBigText, clr)
			self._emit_overlay_label('bottom-left', x, y0 + dy, '(Midpoints)', self.fntBigText, clr)
			return
		# 좌하단: 윗줄 = 장소명(그대로), 아랫줄 = 좌표(예: 126°55'E, 37°31N)
		clr = self.options.clrtexts
		if self.bw:
			clr = (0, 0, 0)

		x = _overlay_margin

		# 줄 간격(현재 폰트 기준)
		_, h = self.fntBigText.getsize("Ag")
		dy = int(h * 1.1)
		# 하단 블록(2줄) 총 높이 = (2-1)*dy + h  = dy + h
		y0 = self.h - _overlay_margin - (dy + h)

		# 방위문자 현지화
		place_chart = self.chart
		if self.chart2 is not None and getattr(self.chart2, 'htype', None) == chart.Chart.TRANSIT:
			place_chart = self.chart2
		dir_lon = mtexts.txts['E'] if place_chart.place.east  else mtexts.txts['W']
		dir_lat = mtexts.txts['N'] if place_chart.place.north else mtexts.txts['S']
		# 장소명
		name_txt = str(place_chart.place.place)

		# 각도 표기(도°/분′), 초는 생략(원하면 동일한 방식으로 추가 가능)
		lon_txt = (str(place_chart.place.deglon)).zfill(2) + self.deg_symbol + (str(place_chart.place.minlon)).zfill(2) + "'" + dir_lon
		lat_txt = (str(place_chart.place.deglat)).zfill(2) + self.deg_symbol + (str(place_chart.place.minlat)).zfill(2) + "'" + dir_lat
		coord_txt = f"{lon_txt}, {lat_txt}"

		# 출력 (장소명 위줄, 좌표는 아래줄)
		self._emit_overlay_label('bottom-left', x, y0,      name_txt,  self.fntBigText, clr)
		self._emit_overlay_label('bottom-left', x, y0 + dy, coord_txt, self.fntBigText, clr)

	def drawLines(self, deg, shift, r1, r2):
		(cx, cy) = self.center.Get()
		i = math.pi+math.radians(shift)
		while i>-math.pi+math.radians(shift):
			x1 = cx+math.cos(i)*r1
			y1 = cy+math.sin(i)*r1
			x2 = cx+math.cos(i)*r2
			y2 = cy+math.sin(i)*r2

			self.bdc.DrawLine(x1, y1, x2, y2)
			i -= deg


	def drawTermsLines(self):
		(cx, cy) = self.center.Get()
		asclon = self._rotation_asc(sidereal=True)

		shift = math.radians(asclon)
		signdeg = float(chart.Chart.SIGN_DEG)
		num = len(self.options.terms[self.options.selterm])
		subnum = len(self.options.terms[self.options.selterm][0])
		sign = 0.0
		for i in range(num):
			deg = sign
			for j in range(subnum):
				deg += float(self.options.terms[self.options.selterm][i][j][1])

				x1 = cx+math.cos(math.pi+shift-math.radians(deg))*self.rTerms
				y1 = cy+math.sin(math.pi+shift-math.radians(deg))*self.rTerms
				x2 = cx+math.cos(math.pi+shift-math.radians(deg))*self.rDecans
				y2 = cy+math.sin(math.pi+shift-math.radians(deg))*self.rDecans

				self.bdc.DrawLine(x1, y1, x2, y2)

			sign += signdeg


	def drawTerms(self):
		(cx, cy) = self.center.Get()
		clr = (0,0,0)
		if not self.bw:
			clr = self.options.clrsigns

		asclon = self._rotation_asc(sidereal=True)
		shift = math.radians(asclon)
		signdeg = float(chart.Chart.SIGN_DEG)
		num = len(self.options.terms[self.options.selterm])
		subnum = len(self.options.terms[self.options.selterm][0])
		sign = 0.0
		for i in range(num):
			deg = sign
			for j in range(subnum):
				pldeg = deg+float(self.options.terms[self.options.selterm][i][j][1])/2.0
				deg += float(self.options.terms[self.options.selterm][i][j][1])

				x = cx+math.cos(math.pi+shift-math.radians(pldeg))*self.rTermsPlanet
				y = cy+math.sin(math.pi+shift-math.radians(pldeg))*self.rTermsPlanet

				self.draw.text((x-self.smallsymbolSize/2, y-self.smallsymbolSize/2), common.common.Planets[self.options.terms[self.options.selterm][i][j][0]], fill=clr, font=self.fntSmallMorinus)

			sign += signdeg


	def drawDecansLines(self):
		(cx, cy) = self.center.Get()

		asclon = self._rotation_asc(sidereal=True)

		shift = asclon
		deg = GraphChart.DEG10
		i = math.pi+math.radians(shift)
		while i>-math.pi+math.radians(shift):
			x1 = cx+math.cos(i)*self.rInner
			y1 = cy+math.sin(i)*self.rInner
			x2 = cx+math.cos(i)*self.rDecans
			y2 = cy+math.sin(i)*self.rDecans

			self.bdc.DrawLine(x1, y1, x2, y2)
			i -= deg


	def drawDecans(self):
		(cx, cy) = self.center.Get()
		clr = (0,0,0)
		if not self.bw:
			clr = self.options.clrsigns

		asclon = self._rotation_asc(sidereal=True)

		shift = math.radians(asclon)
		num = len(self.options.decans[self.options.seldecan])
		subnum = len(self.options.decans[self.options.seldecan][0])
		deg = 5.0
		for i in range(num):
			for j in range(subnum):
				x = cx+math.cos(math.pi+shift-math.radians(deg))*self.rDecansPlanet
				y = cy+math.sin(math.pi+shift-math.radians(deg))*self.rDecansPlanet

				self.draw.text((x-self.smallsymbolSize/2, y-self.smallsymbolSize/2), common.common.Planets[self.options.decans[self.options.seldecan][i][j]], fill=clr, font=self.fntSmallMorinus)

				deg += 10.0


	def drawPlanetLines(self, chrt, pshift, r0, rl1, r02=None, rl2=None):
		clr = (0,0,0)
		if not self.bw:
			clr = self.options.clrframe
		w = self._medium_width()

		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)
		for body_id in self._iter_draw_body_ids(chrt):
			self.drawPlanetLine(chrt, body_id, r0, rl1, pshift)
			if r02 != None:
				self.drawPlanetLine(chrt, body_id, r02, rl2, pshift)


	def drawPlanetLine(self, chrt, planet, r1, r2, pshift):
		(cx, cy) = self.center.Get()

		lon = self._get_body_lon(chrt, planet)
		if lon is None:
			return

		x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon))*r1
		y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon))*r1
		x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon-pshift[planet]))*r2
		y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon-pshift[planet]))*r2
		self.bdc.DrawLine(x1, y1, x2, y2)


	def drawFixstars(self, showfss):
		if not hasattr(self.chart, 'fixstars') or not getattr(self.chart.fixstars, 'data', None):
			return

		(cx, cy) = self.center.Get()

		clr = self.options.clrtexts
		if self.bw:
			clr = (0,0,0)

		num = len(showfss)
		for i in range(num):
			# 각도(수정 반영) → 라벨 반경(AP와 동일 레인)
			ang = util.normalize(self._rotation_asc()
								- self.chart.fixstars.data[showfss[i]][fixstars.FixStars.LON]
								- self.fsshift[i])
			rad = math.pi + math.radians(ang)
			r_text = self.rOuterLine + self._outer_radius_offset()

			# 좌표(세로 스택 오프셋 포함)
			x = cx + math.cos(rad) * r_text
			y = cy + math.sin(rad) * r_text + self.fsyoffs[i]

			# 라벨 문자열(전통/스위스 명칭 + 도/분)
			nom = self.chart.fixstars.data[showfss[i]][fixstars.FixStars.NOMNAME]
			raw = self.chart.fixstars.data[showfss[i]][fixstars.FixStars.NAME]
			txt = astrology.display_fixstar_name(nom, self.options, raw)

			fslon = self.chart.fixstars.data[showfss[i]][fixstars.FixStars.LON]
			if self.options.ayanamsha != 0:
				fslon -= self.chart.ayanamsha
				fslon = util.normalize(fslon)
			(d, m, s) = util.decToDeg(fslon)
			d, m = util.roundDeg(d % chart.Chart.SIGN_DEG, m, s)
			suffix = ' ' + str(d) + self.deg_symbol + str(m).zfill(2) + "'"
			txt += suffix

			# 좌/우 반구 정렬 + 외곽 원(rOuterLine) 밖 유지
			w, h = self.fntText.getsize(txt)
			pos = util.normalize(math.degrees(rad))
			if 90.0 < pos < 270.0:
				x -= w
			x, y, _ = self._ensure_text_outside_outer_wheel(rad, x, y, w, h, r_text, pad_px=self._outer_outside_pad())
			# Painted in the overlay layer instead of on the bitmap so the
			# full label can extend into the panel gutter — no truncation.
			# Hover region is still registered in bitmap space at the same
			# coords; since the bitmap is a centered square in the panel,
			# the painted (panel-space) and registered (bitmap-space)
			# positions coincide for the part of the label that overlaps
			# the bitmap rect (the wheel-periphery side of the text).
			self._emit_overlay_ring_label(x, y - h / 2, txt, self.fntText, clr)
			self._register_secondary_ring_text_hover(
				'fixed_star',
				nom or raw or showfss[i],
				txt,
				self.fntText,
				x,
				y - h / 2,
				txt,
				self.chart.fixstars.data[showfss[i]][fixstars.FixStars.LON],
				display_lon=fslon,
				priority=46,
				data={
					'chart': self.chart,
					'colour': clr,
					'fixstar_code': nom,
					'fixstar_name': raw,
					'fixstar_nature': fixedstar_natures.as_payload(nom),
				},
			)



	def drawFixstarsLines(self, showfss):
		if not hasattr(self.chart, 'fixstars') or not getattr(self.chart.fixstars, 'data', None):
			return

		(cx, cy) = self.center.Get()

		clr = self.options.clrframe
		if self.bw:
			clr = (0,0,0)
		w = self._medium_width()

		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)

		num = len(showfss)
		for i in range (num):
			x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-self.chart.fixstars.data[showfss[i]][fixstars.FixStars.LON]))*self.r30
			y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-self.chart.fixstars.data[showfss[i]][fixstars.FixStars.LON]))*self.r30
			x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-self.chart.fixstars.data[showfss[i]][fixstars.FixStars.LON]-self.fsshift[i]))*self.rOuterLine
			y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-self.chart.fixstars.data[showfss[i]][fixstars.FixStars.LON]-self.fsshift[i]))*self.rOuterLine
			self.bdc.DrawLine(x1, y1, x2, y2)

	def drawAsteroids(self, asteroid_rows, showasteroids, asteroidshift, asteroidyoffs):
		if not asteroid_rows:
			return

		(cx, cy) = self.center.Get()

		clr = self.options.clrtexts
		if self.bw:
			clr = (0,0,0)

		num = len(showasteroids)
		for i in range(num):
			raw_lon = asteroid_rows[showasteroids[i]][fixstars.FixStars.LON]
			ang = util.normalize(self._rotation_asc() - raw_lon - asteroidshift[i])
			rad = math.pi + math.radians(ang)
			r_text = self.rOuterLine + self._outer_radius_offset()

			x = cx + math.cos(rad) * r_text
			y = cy + math.sin(rad) * r_text + asteroidyoffs[i]

			txt = asteroid_rows[showasteroids[i]][fixstars.FixStars.NAME]
			lon = raw_lon
			if self.options.ayanamsha != 0:
				lon = util.normalize(lon - self.chart.ayanamsha)
			(d, m, s) = util.decToDeg(lon)
			d, m = util.roundDeg(d % chart.Chart.SIGN_DEG, m, s)
			suffix = ' ' + str(d) + self.deg_symbol + str(m).zfill(2) + "'"
			txt += suffix

			w, h = self.fntText.getsize(txt)
			pos = util.normalize(math.degrees(rad))
			if 90.0 < pos < 270.0:
				x -= w
			x, y, _ = self._ensure_text_outside_outer_wheel(rad, x, y, w, h, r_text, pad_px=self._outer_outside_pad())
			# Overlay-painted so the full asteroid name + degrees can
			# extend into the panel gutter without bitmap-edge truncation.
			self._emit_overlay_ring_label(x, y - h / 2, txt, self.fntText, clr)
			self._register_secondary_ring_text_hover(
				'asteroid',
				'%s:%s' % (txt, showasteroids[i]),
				txt,
				self.fntText,
				x,
				y - h / 2,
				txt,
				raw_lon,
				display_lon=lon,
				priority=46,
				data={'chart': self.chart, 'colour': clr},
			)

	def drawAsteroidsLines(self, asteroid_rows, showasteroids, asteroidshift):
		if not asteroid_rows:
			return

		(cx, cy) = self.center.Get()

		clr = self.options.clrframe
		if self.bw:
			clr = (0,0,0)
		w = self._medium_width()

		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)

		num = len(showasteroids)
		for i in range(num):
			lon = asteroid_rows[showasteroids[i]][fixstars.FixStars.LON]
			x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon))*self.r30
			y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon))*self.r30
			x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-lon-asteroidshift[i]))*self.rOuterLine
			y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-lon-asteroidshift[i]))*self.rOuterLine
			self.bdc.DrawLine(x1, y1, x2, y2)

	def _get_midpoint_ring_segments(self, item):
		metrics = self._get_midpoint_ring_label_metrics(item)
		return (metrics['p1'], metrics['sep'], metrics['p2'])

	def _get_midpoint_ring_label_metrics(self, item):
		key = (item['p1'], item['p2'])
		cache = getattr(self, '_midpoint_ring_label_metrics_cache', None)
		if cache is None:
			cache = {}
			self._midpoint_ring_label_metrics_cache = cache
		metrics = cache.get(key)
		if metrics is None:
			p1 = common.common.get_planet_glyph(item['p1'])
			sep = ' - '
			p2 = common.common.get_planet_glyph(item['p2'])
			wp1, hp1 = self.fntSmallMorinus.getsize(p1)
			wsep, hsep = self.fntSmallText2.getsize(sep)
			wp2, hp2 = self.fntSmallMorinus.getsize(p2)
			metrics = {
				'p1': p1,
				'sep': sep,
				'p2': p2,
				'wp1': wp1,
				'hp1': hp1,
				'wsep': wsep,
				'hsep': hsep,
				'wp2': wp2,
				'hp2': hp2,
				'w': wp1 + wsep + wp2,
				'h': max(hp1, hsep, hp2),
			}
			cache[key] = metrics
		return metrics

	def _get_midpoint_ring_label_size(self, item):
		metrics = self._get_midpoint_ring_label_metrics(item)
		return (metrics['w'], metrics['h'])

	def _get_midpoint_ring_geometry(self):
		geometry = getattr(self, '_midpoint_ring_geometry_cache', None)
		if geometry is None:
			cx, cy = self.center.Get()
			geometry = (cx, cy, self._rotation_asc(), int(self.symbolSize * 0.10))
			self._midpoint_ring_geometry_cache = geometry
		return geometry

	def _midpoint_ring_layout_key(self, midpoint_items, showmidpoints, rText):
		items_key = tuple(
			(item['p1'], item['p2'], round(float(item['lon']), 6))
			for item in midpoint_items
		)
		morinus_size = self.fntSmallMorinus.getsize('A')
		separator_size = self.fntSmallText2.getsize(' - ')
		return (
			items_key,
			tuple(showmidpoints),
			round(float(rText), 3),
			round(float(self.rOuterLine), 3),
			round(float(self.symbolSize), 3),
			round(float(self._rotation_asc()), 6),
			int(self.w),
			int(self.h),
			(int(morinus_size[0]), int(morinus_size[1])),
			(int(separator_size[0]), int(separator_size[1])),
		)

	def _midpoint_ring_layout_cache(self):
		try:
			cache = _MIDPOINT_RING_LAYOUT_CACHE.get(self.chart)
		except Exception:
			return {}
		if not isinstance(cache, dict):
			cache = {}
			try:
				_MIDPOINT_RING_LAYOUT_CACHE[self.chart] = cache
			except Exception:
				return {}
		return cache

	def _midpoint_ring_layout(self, midpoint_items, showmidpoints, rText):
		key = self._midpoint_ring_layout_key(midpoint_items, showmidpoints, rText)
		cache = self._midpoint_ring_layout_cache()
		cached = cache.get(key)
		if cached is not None:
			shift, yoffs = cached
			return list(shift), list(yoffs)

		shift = self.arrangeMidpointRing(midpoint_items, rText)
		yoffs = self.arrangeyMidpointRing(midpoint_items, shift, showmidpoints, rText)
		if cache is not None:
			cache[key] = (tuple(shift), tuple(yoffs))
			while len(cache) > 8:
				try:
					cache.pop(next(iter(cache)))
				except Exception:
					break
		return shift, yoffs

	def _get_midpoint_ring_label_pos(self, item, shift, yoff, r_text):
		cache = getattr(self, '_midpoint_ring_label_pos_cache', None)
		key = None
		if cache is not None:
			key = (item['p1'], item['p2'], round(float(item['lon']), 6), round(float(shift), 3), round(float(yoff), 3), round(float(r_text), 3))
			pos = cache.get(key)
			if pos is not None:
				return pos
		cx, cy, rotation_asc, pad_px = self._get_midpoint_ring_geometry()
		ang = util.normalize(rotation_asc - item['lon'] - shift)
		rad = math.pi + math.radians(ang)
		w, h = self._get_midpoint_ring_label_size(item)
		x = cx + math.cos(rad) * r_text
		y = cy + math.sin(rad) * r_text + yoff
		pos = util.normalize(math.degrees(rad))
		if 90.0 < pos < 270.0:
			x -= w
		x, y, _ = self._ensure_text_outside_outer_wheel(rad, x, y, w, h, r_text, pad_px=pad_px)
		pos = (x, y, w, h, rad)
		if cache is not None and key is not None:
			cache[key] = pos
		return pos

	def arrangeMidpointRing(self, midpoint_items, rText):
		fshift = [0.0] * len(midpoint_items)
		if len(midpoint_items) < 2:
			return fshift[:]

		for _ in range(len(midpoint_items) + 1):
			self.doMidpointRingArrange(midpoint_items, fshift, rText)

		shifted = self.doMidpointRingShift(len(midpoint_items)-1, 0, midpoint_items, fshift, rText, True)
		if shifted:
			for _ in range(len(midpoint_items)):
				self.doMidpointRingArrange(midpoint_items, fshift, rText, True)
		elif midpoint_items[-1]['lon'] > 300.0 and midpoint_items[0]['lon'] < 60.0:
			lon1 = midpoint_items[-1]['lon'] + fshift[-1]
			lon2 = midpoint_items[0]['lon'] + 360.0 + fshift[0]
			if lon1 > lon2:
				dist = lon1 - lon2
				fshift[0] += dist
				self.doMidpointRingShift(len(midpoint_items)-1, 0, midpoint_items, fshift, rText, True)
				for i in range(len(midpoint_items)-1):
					lon1 = midpoint_items[i]['lon'] + fshift[i]
					lon2 = midpoint_items[i+1]['lon'] + fshift[i+1]
					if lon1 < 180.0 and lon2 < 180.0 and lon1 > lon2:
						fshift[i+1] += (lon1 - lon2)
						self.doMidpointRingShift(i, i+1, midpoint_items, fshift, rText, True)
					else:
						break
				for _ in range(len(midpoint_items)):
					self.doMidpointRingArrange(midpoint_items, fshift, rText, True)

		return fshift[:]

	def doMidpointRingArrange(self, midpoint_items, fshift, rText, forward=False):
		shifted = False
		for i in range(len(midpoint_items)-1):
			shifted = self.doMidpointRingShift(i, i+1, midpoint_items, fshift, rText, forward) or shifted
		if shifted:
			self.doMidpointRingArrange(midpoint_items, fshift, rText, forward)

	def doMidpointRingShift(self, idx1, idx2, midpoint_items, fshift, rText, forward=False):
		x1, y1, w1, h1, _ = self._get_midpoint_ring_label_pos(midpoint_items[idx1], fshift[idx1], 0.0, rText)
		x2, y2, w2, h2, _ = self._get_midpoint_ring_label_pos(midpoint_items[idx2], fshift[idx2], 0.0, rText)
		shifted = False
		while self.overlap(x1, y1 - h1/2.0, w1, h1, x2, y2 - h2/2.0, w2, h2):
			if not forward:
				fshift[idx1] -= 0.1
			fshift[idx2] += 0.1
			x1, y1, w1, h1, _ = self._get_midpoint_ring_label_pos(midpoint_items[idx1], fshift[idx1], 0.0, rText)
			x2, y2, w2, h2, _ = self._get_midpoint_ring_label_pos(midpoint_items[idx2], fshift[idx2], 0.0, rText)
			shifted = True
		return shifted

	def arrangeyMidpointRing(self, midpoint_items, midpointshift, showmidpoints, rText):
		(cx, cy) = self.center.Get()
		yoffs = [0.0] * len(showmidpoints)
		if len(showmidpoints) < 2:
			return yoffs[:]

		for _ in range(len(showmidpoints)):
			changed = False
			for i in range(len(showmidpoints)-1):
				idx1 = showmidpoints[i]
				idx2 = showmidpoints[i+1]
				x1, y1, w1, h1, _ = self._get_midpoint_ring_label_pos(midpoint_items[idx1], midpointshift[i], yoffs[i], rText)
				x2, y2, w2, h2, _ = self._get_midpoint_ring_label_pos(midpoint_items[idx2], midpointshift[i+1], yoffs[i+1], rText)
				while self.overlap(x1, y1 - h1/2.0, w1, h1, x2, y2 - h2/2.0, w2, h2):
					if y1 > cy:
						yoffs[i] += 1.0
					else:
						yoffs[i] -= 1.0
					if y2 > cy:
						yoffs[i+1] += 1.0
					else:
						yoffs[i+1] -= 1.0
					x1, y1, w1, h1, _ = self._get_midpoint_ring_label_pos(midpoint_items[idx1], midpointshift[i], yoffs[i], rText)
					x2, y2, w2, h2, _ = self._get_midpoint_ring_label_pos(midpoint_items[idx2], midpointshift[i+1], yoffs[i+1], rText)
					changed = True
			if not changed:
				break
		return yoffs[:]

	def drawMidpointLines(self, midpoint_items, showmidpoints, midpointshift):
		if not midpoint_items:
			return
		rows = common.build_ring_text_rows(midpoint_items)
		self.drawAsteroidsLines(rows, showmidpoints, midpointshift)

	def drawMidpoints(self, midpoint_items, showmidpoints, midpointshift, midpointyoffs):
		if not midpoint_items:
			return

		clr = self.options.clrtexts if not self.bw else (0, 0, 0)
		palette = (
			self.options.clrdomicil,
			self.options.clrexal,
			self.options.clrperegrin,
			self.options.clrcasus,
			self.options.clrexil,
		)
		for i, idx in enumerate(showmidpoints):
			item = midpoint_items[idx]
			x, y, w, h, _rad = self._get_midpoint_ring_label_pos(item, midpointshift[i], midpointyoffs[i], self.rOuterLine + self._outer_radius_offset())
			label_x = x
			metrics = self._get_midpoint_ring_label_metrics(item)
			p1, sep, p2 = metrics['p1'], metrics['sep'], metrics['p2']
			clr1 = self._get_body_color(self.chart, item['p1'], palette)
			clr2 = self._get_body_color(self.chart, item['p2'], palette)
			wp1, hp1 = metrics['wp1'], metrics['hp1']
			wsep, hsep = metrics['wsep'], metrics['hsep']
			wp2, hp2 = metrics['wp2'], metrics['hp2']
			y_text = y - h / 2.0
			self.draw.text((x, y_text + (h - hp1) / 2.0), p1, fill=clr1, font=self.fntSmallMorinus)
			x += wp1
			self.draw.text((x, y_text + (h - hsep) / 2.0), sep, fill=clr, font=self.fntSmallText2)
			x += wsep
			self.draw.text((x, y_text + (h - hp2) / 2.0), p2, fill=clr2, font=self.fntSmallMorinus)
			display_lon = item['lon']
			if self.options.ayanamsha != 0:
				display_lon = util.normalize(display_lon - self.chart.ayanamsha)
			self._register_hover_region(
				'secondary_ring',
				'%s:%s' % (item['p1'], item['p2']),
				label_x,
				y_text,
				w,
				h,
				priority=46,
				data={
					'family': 'midpoint',
					'title': '%s - %s' % (common.common.get_planet_name(item['p1']), common.common.get_planet_name(item['p2'])),
					'longitude': item['lon'],
					'display_lon': display_lon,
					'chart': self.chart,
					'colour': clr,
				},
			)

	def arrangeParts(self, parts, showidxs, rText):
		"""
		항성/도데카테모리온과 같은 방식:
		- 가까운 항목끼리 사각형이 겹치면 앞쪽(+), 뒤쪽(-)으로 0.1°씩 각도를 밀어낸다
		- 360/0 경계도 처리
		- 텍스트 폭/높이를 실제로 써서 겹침 판단
		"""
		import math
		(cx, cy) = self.center.Get()
		n = len(showidxs)
		fshift = [0.0] * n
		if n < 2:
			return fshift[:]

		# 정렬용 배열
		order  = [parts[idx][arabicparts.ArabicParts.LONG] for idx in showidxs]
		mixed  = list(range(n))  # showidxs의 인덱스

		# 경도 기준 정렬(오름차순)
		for j in range(n):
			for i in range(n-1):
				if order[i] > order[i+1]:
					order[i], order[i+1] = order[i+1], order[i]
					mixed[i], mixed[i+1] = mixed[i+1], mixed[i]

		def rect(i):
			"""현재 i(정렬 뒤 인덱스)의 라벨 사각형(좌상단 x, y, w, h)"""
			real_idx = mixed[i]
			idx = showidxs[real_idx]
			name = parts[idx][arabicparts.ArabicParts.NAME]
			lon  = order[i]
			ang  = util.normalize(self._rotation_asc() - lon - fshift[real_idx])
			rad  = math.pi + math.radians(ang)
			x    = cx + math.cos(rad) * rText
			y    = cy + math.sin(rad) * rText
			w, h = self.fntText.getsize(name)
			pos  = util.normalize(math.degrees(rad))
			if 90.0 < pos < 270.0:  # 좌반구 오른쪽 정렬
				x -= w
			return (x, y - h/2.0, w, h)

		# 인접쌍 + 360/0 경계 처리
		def do_shift(p1, p2, forward=False):
			shifted = False
			x1, y1, w1, h1 = rect(p1)
			x2, y2, w2, h2 = rect(p2)
			while self.overlap(x1, y1, w1, h1, x2, y2, w2, h2):
				if not forward:
					fshift[mixed[p1]] -= 0.18
				fshift[mixed[p2]] += 0.18
				shifted = True
				STEP_DEG = 0.5    # ← 0.15~0.22 사이 취향대로
				GUARD    = 600     # ← 무한루프 방지

				cnt = 0
				while self.overlap(x1, y1, w1, h1, x2, y2, w2, h2) and cnt < GUARD:
					if not forward:
						fshift[mixed[p1]] -= STEP_DEG
					fshift[mixed[p2]] += STEP_DEG
					cnt += 1
					x1, y1, w1, h1 = rect(p1)
					x2, y2, w2, h2 = rect(p2)

			return shifted

		def do_arrange(forward=False):
			shifted_local = False
			for i in range(n-1):
				if do_shift(i, i+1, forward):
					shifted_local = True
			if shifted_local:
				do_arrange(forward)

		# 여러 번 훑어서 벌리기
		for _ in range(max(2, n + 2)):   # ← n+1 → n+2 정도로 한 번 더
			do_arrange(False)

		# 360/0 경계
		def angle_plus_shift(i):
			return order[i] + (fshift[mixed[i]] if order[i] < 180 else fshift[mixed[i]])
		# 경계에서 거꾸로 겹치는 경우만 앞으로(+ 방향) 밀기
		shifted = do_shift(n-1, 0, True)
		if shifted:
			# 경계 밀림 이후 재정렬
			for _ in range(n):
				do_arrange(True)
		else:
			# 경계는 안 겹치는데, “끝이 앞을 넘어서는” 케이스 보정
			if order[n-1] > 300.0 and order[0] < 60.0:
				lon1 = order[n-1] + fshift[mixed[n-1]]
				lon2 = order[0] + 360.0 + fshift[mixed[0]]
				if lon1 > lon2:
					dist = lon1 - lon2
					fshift[mixed[0]] += dist
					do_shift(n-1, 0, True)
					for i in range(n-1):
						l1 = order[i]   + fshift[mixed[i]]
						l2 = order[i+1] + fshift[mixed[i+1]]
						if l1 < 180.0 and l2 < 180.0 and l1 > l2:
							fshift[mixed[i+1]] += (l1 - l2)
							do_shift(i, i+1, True)
						else:
							break
					for _ in range(n):
						do_arrange(True)

		return fshift[:]


	def drawArabicParts(self, parts, showidxs, fshift, yoffs, C=None):
		C = C or self.chart
		(cx, cy) = self.center.Get()
		clr = self.options.clrtexts if not self.bw else (0, 0, 0)
		base_asc = self._rotation_asc()
		# Day/night flag the parts engine itself used when computing these
		# lots — needed by arabicparts.format_formula_text to render the
		# right active triplet (formulas swap for nocturnal charts).
		try:
			lof_above = bool(C.fortune.abovehorizon)
		except Exception:
			try:
				lof_above = bool(getattr(C, 'abovehorizonwithorb', True))
			except Exception:
				lof_above = True
		chart_male = bool(getattr(C, 'male', True))
		lof_name = mtexts.txts.get('LotOfFortune', 'Fortuna')

		for i, idx in enumerate(showidxs):
			lon  = parts[idx][arabicparts.ArabicParts.LONG]
			name = parts[idx][arabicparts.ArabicParts.NAME]

			base = base_asc - lon

			ang = util.normalize(base - fshift[i])
			rad = math.pi + math.radians(ang)

			# 라벨 레인: 선 끝보다 살짝 바깥
			r_text = self.rOuterLine + self._outer_radius_offset()

			# 초기 배치
			x = cx + math.cos(rad) * r_text
			y = cy + math.sin(rad) * r_text + yoffs[i]

			# 좌/우 반구 정렬
			pos = util.normalize(math.degrees(rad))
			w, h = self.fntText.getsize(name)
			if 90.0 < pos < 270.0:
				x -= w
			# ★ outer wheel 침범 방지: 필요 시 바깥으로 살짝 더 밀어내기
			x, y, r_text = self._ensure_text_outside_outer_wheel(rad, x, y, w, h, r_text, pad_px=self._outer_outside_pad())
			# Overlay-painted: full lot name extends into the panel gutter,
			# unconstrained by the bitmap square.
			self._emit_overlay_ring_label(x, y - h/2, name, self.fntText, clr)
			display_lon = lon
			if self.options.ayanamsha != 0:
				display_lon = util.normalize(lon - C.ayanamsha)
			# Resolve the formula text up front so the inspector pane can
			# show "Asc + Moon - Sun" instead of just the bare lot name.
			# Lot of Fortune isn't in options.ar (it's picked via the LoF
			# dialog) so it goes through its own variant-aware formatter.
			formula_text = None
			try:
				if name == lof_name:
					formula_text = arabicparts.format_lof_formula_text(
						self.options.lotoffortune, lof_above,
					)
				else:
					# Options stores the custom-parts table under `.arabicparts`
					# (not `.ar` — that's just the internal parameter name on
					# `ArabicParts.__init__`). Using getattr keeps it from
					# blowing up on older option dumps that never serialised
					# the list.
					ar_item = arabicparts.ArabicParts.find_ar_item_by_name(
						getattr(self.options, 'arabicparts', None), name,
					)
					if ar_item is not None:
						formula_text = arabicparts.ArabicParts.format_formula_text(
							ar_item, lof_above, chart_male,
						)
			except Exception:
				formula_text = None
			self._register_secondary_ring_text_hover(
				'lot',
				'%s:%s' % (name, idx),
				name,
				self.fntText,
				x,
				y - h / 2,
				name,
				lon,
				display_lon=display_lon,
				chart_role='outer' if C is self.chart2 else 'primary',
				priority=46,
				data={'chart': C, 'colour': clr, 'formula': formula_text},
			)

	def drawOuterFortuneText(self, C=None):
		C = C or self.chart

		# 기존에는 self.chart만 검사/사용해서 외곽 휠에서는 빠졌음 → C를 기준으로 사용
		if not hasattr(C, "fortune") or C.fortune is None:
			return
		try:
			lon = C.fortune.fortune[fortune.Fortune.LON]
		except Exception:
			return

		(cx, cy) = self.center.Get()
		clr  = self.options.clrtexts if not self.bw else (0, 0, 0)
		name = mtexts.txts.get('LotOfFortune', 'Fortuna')

		base = self._rotation_asc() - lon
		# ★ AP와의 충돌 시 포르투나는 반대 부호로 이동하도록, drawArabicPartsLines에서 저장한 값을 그대로 사용
		ang  = util.normalize(base + getattr(self, "_fortune_outer_shift", 0.0))

		rad  = math.pi + math.radians(ang)

		# 라벨 레인: 선 끝보다 살짝 바깥
		r_text = self.rOuterLine + self._outer_radius_offset()

		x = cx + math.cos(rad) * r_text
		y = cy + math.sin(rad) * r_text

		pos = util.normalize(math.degrees(rad))
		w, h = self.fntText.getsize(name)
		if 90.0 < pos < 270.0:
			x -= w

		parts = getattr(self, "_parts_ap2", None) if C is self.chart2 else getattr(self, "_parts_ap", None)
		apshow = getattr(self, "apshow2", None) if C is self.chart2 else getattr(self, "apshow", None)
		apshift = getattr(self, "apshift2", None) if C is self.chart2 else getattr(self, "apshift", None)
		apyoffs = getattr(self, "apyoffs2", None) if C is self.chart2 else getattr(self, "apyoffs", None)

		# --- 모든 AP 최종 라벨 사각형과 충돌이 없을 때까지 세로 스택 ---
		if parts is not None and apshow is not None and apshift is not None and apyoffs is not None:
			def fort_rect():
				return (x, y - h/2.0, w, h, pos)

			def ap_rect(i):
				idx  = apshow[i]
				alon = parts[idx][arabicparts.ArabicParts.LONG]
				aang = util.normalize(self._rotation_asc() - alon - apshift[i])
				arad = math.pi + math.radians(aang)
				ax   = cx + math.cos(arad) * r_text
				ay   = cy + math.sin(arad) * r_text + apyoffs[i]
				aw, ah = self.fntText.getsize(parts[idx][arabicparts.ArabicParts.NAME])
				apos = util.normalize(math.degrees(arad))
				if 90.0 < apos < 270.0:
					ax -= aw
				return (ax, ay - ah/2.0, aw, ah)

			changed = True
			while changed:
				changed = False
				fx, fy, fw, fh, _ = fort_rect()
				for i in range(len(apshow)):
					ax, ay, aw, ah = ap_rect(i)
					if self.overlap(fx, fy, fw, fh, ax, ay, aw, ah):
						# 좌반구(텍스트 오른쪽 정렬)는 아래로(+), 우반구는 위로(-) 이동
						y += 1.0 if (90.0 < pos < 270.0) else -1.0
						changed = True
						break

			pass

		# ★ outer wheel 침범 방지
		#x, y, r_text = self._ensure_text_outside_outer_wheel(rad, x, y, w, h, r_text, pad_px=int(self.symbolSize*0.10))

		# Overlay-painted — full Fortuna label extends into the gutter
		# rather than being clipped at the bitmap square edge.
		self._emit_overlay_ring_label(x, y - h/2, name, self.fntText, clr)

	def drawArabicPartsLines(self, parts, showidxs, fshift, C=None):
		C = C or self.chart

		(cx, cy) = self.center.Get()
		clr = self.options.clrframe if not self.bw else (0, 0, 0)
		w = self._scaled_line_w(2 * self._visual_factor('mediumStrokeBase'))
		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)

		self._af_split_idx = None
		self._af_split_deg = 0.0
		self._fortune_outer_shift = 0.0

		# Fortuna 라인/텍스트에서 재사용할 보정각
		self._fortune_outer_shift = float(self._af_split_deg)

		# 핵심: 시작점은 ‘원래 황경 각’(r30), 끝점은 ‘겹침 보정 후 라벨 각’(rOuterLine)
		for i, idx in enumerate(showidxs):
			lon  = parts[idx][arabicparts.ArabicParts.LONG]
			base = util.normalize(self._rotation_asc() - lon)
			#shift = fshift[i] + (self._af_split_deg if self._af_split_idx == i else 0.0)
			shift = fshift[i]
			rad_in  = math.pi + math.radians(base)                          # r30: 원래 황경
			rad_out = math.pi + math.radians(util.normalize(base - shift))   # rOuterLine: 라벨 각

			x1 = cx + math.cos(rad_in)  * self.r30
			y1 = cy + math.sin(rad_in)  * self.r30
			x2 = cx + math.cos(rad_out) * self.rOuterLine
			y2 = cy + math.sin(rad_out) * self.rOuterLine
			self.bdc.DrawLine(x1, y1, x2, y2)

	def drawAntisLines(self, plnts, lof, ascmc, pshift, r1, r2):
		(cx, cy) = self.center.Get()
		clr = (0,0,0)
		if not self.bw:
			clr = self.options.clrframe
		w = self._medium_width()

		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)
		for i in range (planets.Planets.PLANETS_NUM+3):
			if (i == astrology.SE_URANUS and not self.options.transcendental[chart.Chart.TRANSURANUS]) or (i == astrology.SE_NEPTUNE and not self.options.transcendental[chart.Chart.TRANSNEPTUNE]) or (i == astrology.SE_PLUTO and not self.options.transcendental[chart.Chart.TRANSPLUTO]) or ((i == astrology.SE_MEAN_NODE or i == astrology.SE_TRUE_NODE) and not self.options.shownodes) or (i == planets.Planets.PLANETS_NUM and not self.options.showlof):
				continue

			# Skip Morin antiscia that don't exist (|D| >= obl).
			src = None
			if i < planets.Planets.PLANETS_NUM:
				src = plnts[i]
			elif i == planets.Planets.PLANETS_NUM:
				src = lof
			elif i == planets.Planets.PLANETS_NUM+1:
				src = ascmc[0]
			elif i == planets.Planets.PLANETS_NUM+2:
				src = ascmc[1]
			if src is not None and not getattr(src, 'valid', True):
				continue

			lon = 0.0
			if i < planets.Planets.PLANETS_NUM:
				lon = plnts[i].lon
			elif i == planets.Planets.PLANETS_NUM:
				lon = lof.lon
			elif i == planets.Planets.PLANETS_NUM+1:
				lon = ascmc[0].lon
			elif i == planets.Planets.PLANETS_NUM+2:
				lon = ascmc[1].lon

			base = self._rotation_asc(sidereal=(self.options.ayanamsha != 0))

			# 시작/끝 각도
			ang1 = math.pi + math.radians(base - lon)
			ang2 = math.pi + math.radians(base - lon - pshift[i])

			# 라인 좌표
			x1 = cx + math.cos(ang1) * r1
			y1 = cy + math.sin(ang1) * r1
			x2 = cx + math.cos(ang2) * r2
			y2 = cy + math.sin(ang2) * r2

			self.bdc.DrawLine(x1, y1, x2, y2)

	def drawAntis(self, chrt, plnts, lof, ascmc, pshift, r):
		(cx, cy) = self.center.Get()
		clrs = (self.options.clrdomicil, self.options.clrexal, self.options.clrperegrin, self.options.clrcasus, self.options.clrexil)
		clrpls = self.options.clrperegrin
		clrtxt = self.options.clrtexts
		family, family_title = self._secondary_overlay_hover_family()

		for i in range (planets.Planets.PLANETS_NUM+3):
			if (i == astrology.SE_URANUS and not self.options.transcendental[chart.Chart.TRANSURANUS]) or (i == astrology.SE_NEPTUNE and not self.options.transcendental[chart.Chart.TRANSNEPTUNE]) or (i == astrology.SE_PLUTO and not self.options.transcendental[chart.Chart.TRANSPLUTO]) or ((i == astrology.SE_MEAN_NODE or i == astrology.SE_TRUE_NODE) and not self.options.shownodes) or (i == planets.Planets.PLANETS_NUM and not self.options.showlof):
				continue
			# Skip Morin antiscia that don't exist (|D| >= obl).
			src = None
			if i < planets.Planets.PLANETS_NUM:
				src = plnts[i]
			elif i == planets.Planets.PLANETS_NUM:
				src = lof
			elif i == planets.Planets.PLANETS_NUM+1:
				src = ascmc[0]
			elif i == planets.Planets.PLANETS_NUM+2:
				src = ascmc[1]
			if src is not None and not getattr(src, 'valid', True):
				continue

			lon = 0.0
			txt = ''
			source_name = ''
			fnt = self.fntMorinus
			clr = (0,0,0)
			if i < planets.Planets.PLANETS_NUM:
				lon = plnts[i].lon
				txt = common.common.Planets[i]
				source_name = common.common.get_planet_name(i)
				if not self.bw:
# ##################################
# Elias V 8.0.0 : Always show Antiscia and Dodecatemoria to full color.
					#if self.options.useplanetcolors:
					objidx = i
					if i == planets.Planets.PLANETS_NUM-1:
						objidx -= 1
					clr = self.options.clrindividual[objidx]
					#else:
					#	dign = chrt.dignity(i)
					#	clr = clrs[dign]
# ##################################
			elif i == planets.Planets.PLANETS_NUM:
				lon = lof.lon
				txt = common.common.fortune
				source_name = mtexts.txts.get('LotOfFortune', 'Fortuna')
				if not self.bw:
					if self.options.useplanetcolors:
						clr = self.options.clrindividual[i-1]
					else:
						clr = self.options.clrperegrin
			elif i == planets.Planets.PLANETS_NUM+1:
				lon = ascmc[0].lon
				txt = mtexts.txts['StripAsc']
				source_name = 'Asc'
				fnt = self.fntAntisText
				if not self.bw:
					clr = clrtxt
			elif i == planets.Planets.PLANETS_NUM+2:
				lon = ascmc[1].lon
				txt = mtexts.txts['StripMC']
				source_name = 'MC'
				fnt = self.fntAntisText
				if not self.bw:
					clr = clrtxt

			base = self._rotation_asc(sidereal=(self.options.ayanamsha != 0))

			ang = math.pi + math.radians(base - lon - pshift[i])
			x = cx + math.cos(ang) * r
			y = cy + math.sin(ang) * r

			left = x-self.symbolSize/2
			top = y-self.symbolSize/2
			self.draw.text((left, top), txt, fill=clr, font=fnt)
			if txt:
				self._register_secondary_ring_text_hover(
					family,
					'%s:%s' % (family, i),
					txt,
					fnt,
					left,
					top,
					'%s %s' % (family_title, source_name or txt),
					lon,
					display_lon=lon,
					priority=46,
					data={
						'chart': chrt,
						'colour': clr,
						'glyph': txt if fnt is self.fntMorinus else '',
						'glyph_font': 'morinus' if fnt is self.fntMorinus else 'text',
						'source_name': source_name,
					},
				)

	def arrange(self, chrt, rPlanet, include_details=False, rRetr=None, outer=False):
		'''Arranges planets so they won't overlap each other'''

		body_ids = self._iter_draw_body_ids(chrt)
		size = max(planets.Planets.PLANETS_NUM+1, astrology.SE_CHIRON+1, common.CHART_OBJECT_VERTEX+1)
		pshift = [0.0 for i in range(size)]
		order = [0.0 for i in range(len(body_ids))]
		mixed = [0 for i in range(len(body_ids))]

		pnum = len(body_ids)
		body_font = self.fntOuterMorinus if outer else self.fntMorinus
		for i in range(pnum):
			mixed[i] = body_ids[i]
			order[i] = self._get_body_lon(chrt, body_ids[i])

		#arrange in order, initialize
		for j in range(pnum):
			for i in range(pnum-1):
				if (order[i] > order[i+1]):
					tmp = order[i]
					order[i] = order[i+1]
					order[i+1] = tmp
					tmp = mixed[i]
					mixed[i] = mixed[i+1]
					mixed[i+1] = tmp
		
		#doArrange arranges consecutive two planets only(0 and 1, 1 and 2, ...), this is why we need to do it pnum+1 times
		for i in range(pnum+1):
			self.doArrange(pnum, pshift, order, mixed, rPlanet, font=body_font)

		#Arrange 360-0 transition also
		#We only shift forward at 360-0
		shifted = self.doShift(pnum-1, 0, pshift, order, mixed, rPlanet, True, font=body_font)

		if shifted:
			for i in range(pnum):
				self.doArrange(pnum, pshift, order, mixed, rPlanet, True, font=body_font)

		#check if beyond (not overlapping but beyond)
		else:
			if order[pnum-1] > 300.0 and order[0] < 60.0:
				lon1 = order[pnum-1]+pshift[mixed[pnum-1]]
				lon2 = order[0]+360.0+pshift[mixed[0]]

				if lon1 > lon2:
					dist = lon1-lon2
					pshift[mixed[0]] += dist
					self.doShift(pnum-1, 0, pshift, order, mixed, rPlanet, True, font=body_font)

					for i in range(pnum-1):
						lon1 = order[i]+pshift[mixed[i]]
						lon2 = order[i+1]+pshift[mixed[i+1]]	
						if lon1 < 180.0 and lon2 < 180.0:
							if lon1 > lon2:
								dist = lon1-lon2
								pshift[mixed[i+1]] += dist
								self.doShift(i, i+1, pshift, order, mixed, rPlanet, True, font=body_font)
							else:
								break
						else:
							break

					for i in range(pnum):
						self.doArrange(pnum, pshift, order, mixed, rPlanet, True, font=body_font)

		# Glyph pshift is finalized above (legacy-parity, glyph-rectangle
		# collision at rPlanet). label_pshift stays equal to pshift so inner
		# labels render at the same angle as their glyph (no angular drift).
		# The angular-drift pass `_space_detail_labels` exists but is no
		# longer wired in — it pushed labels off their parent glyph in tight
		# clusters and was rejected on visual inspection.
		label_pshift = pshift[:]
		# label_yoffs: per-body radial offset (in pixels, pushed inward toward
		# center). When include_details=True, `_compute_label_yoffs` runs the
		# arrangeyParts-style two-layer stagger so adjacent inner labels in
		# tight clusters alternate between two radial layers (A/B/A/B).
		size = len(pshift)
		label_yoffs = [0.0] * size
		if include_details:
			self._compute_label_yoffs(chrt, pshift, order, mixed, label_yoffs, outer=outer)
		return pshift[:], label_pshift[:], label_yoffs[:]


	def doArrange(self, pnum, pshift, order, mixed, rPlanet, forward = False, font=None):
		shifted = False

		for i in range(pnum-1):
			shifted = self.doShift(i, i+1, pshift, order, mixed, rPlanet, forward, font=font)

		if shifted:
			self.doArrange(pnum, pshift, order, mixed, rPlanet, forward, font=font)

		return shifted


	def doShift(self, p1, p2, pshift, order, mixed, rPlanet, forward = False, font=None):
		(cx, cy) = self.center.Get()
		shifted = False

		x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-order[p1]-pshift[mixed[p1]]))*rPlanet
		y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-order[p1]-pshift[mixed[p1]]))*rPlanet
		x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-order[p2]-pshift[mixed[p2]]))*rPlanet
		y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-order[p2]-pshift[mixed[p2]]))*rPlanet

		body_font = font or self.fntMorinus
		w1, h1 = body_font.getsize(self._get_body_glyph(mixed[p1]))
		w2, h2 = body_font.getsize(self._get_body_glyph(mixed[p2]))

		while (self.overlap(x1, y1, w1, h1, x2, y2, w2, h2)):
			if not forward:
				pshift[mixed[p1]] -= 0.1
			pshift[mixed[p2]] += 0.1

			x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-order[p1]-pshift[mixed[p1]]))*rPlanet
			y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-order[p1]-pshift[mixed[p1]]))*rPlanet
			x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-order[p2]-pshift[mixed[p2]]))*rPlanet
			y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-order[p2]-pshift[mixed[p2]]))*rPlanet

			if not shifted:
				shifted = True

		return shifted


	def overlap(self, x1, y1, w1, h1, x2, y2, w2, h2):
		xoverlap = (x1 <= x2 and x2 <= x1+w1) or (x2 <= x1 and x1 <= x2+w2)
		yoverlap = (y1 <= y2 and y2 <= y1+h1) or (y2 <= y1 and y1 <= y2+h2)

		if (xoverlap and yoverlap):
			return True

		return False

	def _position_label_half_deg(self, chrt, lon):
		label_pad = float(getattr(self, 'PLANET_LABEL_COLLISION_PAD', 5.0))
		if self.options.ayanamsha != 0:
			lon2 = util.normalize(lon - chrt.ayanamsha)
		else:
			lon2 = lon
		(d, m, s) = util.decToDeg(lon2)
		if self.theme == self.THEME_CLASSIC:
			if not self.options.positions:
				return 0.0
			d = d % chart.Chart.SIGN_DEG
			degtxt = str(d)
			mintxt = str(m).zfill(2)
			wdeg, hdeg = self.fntDegreeText.getsize(degtxt)
			wmin, hmin = self.fntMinuteText.getsize(mintxt)
			return self._pixels_to_degrees((wdeg + wmin) / 2.0, self.rPos, margin=label_pad)

		d, m = util.roundDeg(d % chart.Chart.SIGN_DEG, m, s)
		degtxt = str(d) + self.deg_symbol
		mintxt = str(m) + "'"
		wdeg, hdeg = self.fntDegreeText.getsize(degtxt)
		wmin, hmin = self.fntMinuteText.getsize(mintxt)
		return max(
			self._pixels_to_degrees(wdeg / 2.0, self.rPosDeg, margin=label_pad),
			self._pixels_to_degrees(wmin / 2.0, self.rPosMin, margin=label_pad),
		)

	def _motion_label_half_deg(self, chrt, body_id, rRetr, outer=False):
		if rRetr is None:
			return 0.0
		speed_lon = self._get_body_speed_lon(chrt, body_id)
		station_marker = self._getRadixStationMarker(chrt, body_id)
		if speed_lon is None or (station_marker is None and speed_lon > 0.0):
			return 0.0
		t = station_marker
		if t is None:
			t = 'S'
			if speed_lon < 0.0:
				t = 'R'
		if outer:
			rfnt = self.fntOuterMotion
			if station_marker is not None:
				rfnt = self.fntOuterMotionStation
			w, h = rfnt.getsize(t)
			return self._pixels_to_degrees(w / 2.0, rRetr)
		if self.theme == self.THEME_CLASSIC:
			rfnt = self.fntMotionStation if t in ('SR', 'SD') else self.fntMotionClassic
			w, h = rfnt.getsize(t)
			return self._pixels_to_degrees(w / 2.0, rRetr)
		rfnt = self.fntMotionCompact
		if station_marker is not None:
			rfnt = self.fntMotionStation
		elif speed_lon < 0.0:
			t = common.common.retr
			rfnt = self.fntMotionCompactRetr
		w, h = rfnt.getsize(t)
		return self._pixels_to_degrees(w / 2.0, rRetr)

	def _pixels_to_degrees(self, half_width_px, radius, margin=None):
		if radius <= 0:
			return 0.0
		if margin is None:
			margin = float(getattr(self, 'PLANET_COLLISION_PAD', 2.0))
		return ((half_width_px + float(margin)) / float(radius)) * (180.0 / math.pi)

	def _body_detail_half_deg(self, chrt, body_id, lon, rPlanet, rRetr=None, outer=False):
		body_font = self.fntOuterMorinus if outer else self.fntMorinus
		half = self._label_half_deg(self._get_body_glyph(body_id), body_font, rPlanet, margin_px=getattr(self, 'PLANET_COLLISION_PAD', 2.0))
		if bool(getattr(self, 'disable_planet_detail', False)):
			return half
		half = max(half, self._motion_label_half_deg(chrt, body_id, rRetr, outer=outer))
		if not outer:
			half = max(half, self._position_label_half_deg(chrt, lon))
		return half

	def _space_detail_labels(self, chrt, pshift, order, mixed, rPlanet, rRetr=None, outer=False):
		pnum = len(order)
		if pnum < 2:
			return
		half_widths = [
			self._body_detail_half_deg(chrt, mixed[i], order[i], rPlanet, rRetr=rRetr, outer=outer)
			for i in range(pnum)
		]
		max_passes = max(1, int(getattr(self, 'PLANET_DETAIL_SPACING_PASSES', 4)))
		for _ in range(max_passes):
			shifted = False
			for i in range(pnum-1):
				lon1 = order[i] + pshift[mixed[i]]
				lon2 = order[i+1] + pshift[mixed[i+1]]
				required = half_widths[i] + half_widths[i+1]
				if lon2 - lon1 < required:
					pshift[mixed[i+1]] += required - (lon2 - lon1)
					shifted = True
			if order[pnum-1] > 300.0 and order[0] < 60.0:
				lon1 = order[pnum-1] + pshift[mixed[pnum-1]]
				lon2 = order[0] + 360.0 + pshift[mixed[0]]
				required = half_widths[pnum-1] + half_widths[0]
				if lon2 - lon1 < required:
					pshift[mixed[0]] += required - (lon2 - lon1)
					shifted = True
			if not shifted:
				break

	def _compute_label_yoffs(self, chrt, pshift, order, mixed, label_yoffs, outer=False):
		"""Radial two-layer stagger for inner deg/min labels (arrangeyParts
		pattern, adapted for circular labels). Labels stay at the planet's
		angle but every-other label in a tight cluster is pushed inward by
		one label-height so adjacent labels sit on two distinct radial
		layers and never pixel-overlap. Outer ring is skipped — only the
		inner radix wheel has the rPosDeg/rPosMin stack."""
		if outer:
			return
		pnum = len(order)
		if pnum < 2:
			return
		rPos = getattr(self, 'rPosDeg', None) or getattr(self, 'rPos', None)
		if rPos is None or rPos <= 0:
			return
		(cx, cy) = self.center.Get()

		# Layer separation: just enough that adjacent degree labels don't
		# pixel-overlap. Earlier version used the full deg+min stack height
		# (~16 px) which read as "extreme" — collapse it to the single-row
		# height + a 1 px breath, so the inner stagger is a subtle nudge,
		# not a full second layer of speculum.
		try:
			h_deg = self.fntDegreeText.getsize('00')[1]
			layer_offset = float(h_deg + 1)
		except Exception:
			layer_offset = max(8.0, float(self.symbolSize) * 0.30)

		# Approximate label rect: degree+minute side by side in classic, stacked
		# in modern — use the wider of the two so the overlap check is
		# conservative. Width gets re-evaluated per body via the actual draw
		# strings if available; this is a cheap upper bound.
		try:
			w_deg = self.fntDegreeText.getsize('29' + (self.deg_symbol or ''))[0]
			w_min = self.fntSmallText2.getsize("59'")[0]
			label_w = float(max(w_deg, w_min) + 2)
			label_h = float(max(self.fntDegreeText.getsize('0')[1], self.fntSmallText2.getsize('0')[1]) + 1)
		except Exception:
			label_w = float(self.symbolSize) * 0.9
			label_h = float(self.symbolSize) * 0.5

		def label_rect_at(i, yoff):
			body_id = mixed[i]
			lon = order[i]
			r = rPos - yoff
			ang = self._rotation_asc() - lon - pshift[body_id]
			rad = math.pi + math.radians(ang)
			x = cx + math.cos(rad) * r
			y = cy + math.sin(rad) * r
			return (x - label_w / 2.0, y - label_h / 2.0, label_w, label_h)

		# Cluster-scoped alternation. Per-pair "flip on overlap" produced an
		# irregular pattern where one body in a cluster ended up at the outer
		# layer with no immediate neighbour also at outer — that's the "space
		# around the Sun" look. Treat overlap as a cluster-membership signal
		# and then apply a strict A/B/A/B zig-zag across the whole cluster
		# regardless of per-pair overlap, so the visual treatment is uniform.
		#
		# Pass 1: at the DEFAULT radius (yoff=0), which adjacent pairs would
		# pixel-overlap each other? That's the cluster-edge predicate.
		overlap_flags = [False] * (pnum - 1)
		for i in range(pnum - 1):
			r_a = label_rect_at(i, 0)
			r_b = label_rect_at(i + 1, 0)
			overlap_flags[i] = self.overlap(*r_a, *r_b)

		# Pass 2: walk bodies. A body belongs to a cluster if it overlaps with
		# either its prev or next neighbour. Within a cluster, index from the
		# cluster start drives the layer: even=outer (A, yoff=0), odd=inner
		# (B, yoff=layer_offset). Singletons stay at A. This makes the
		# stagger look like a design choice across the whole cluster rather
		# than a per-pair patch-up.
		cluster_start = None
		for i in range(pnum):
			connects_prev = (i > 0 and overlap_flags[i - 1])
			connects_next = (i < pnum - 1 and overlap_flags[i])
			in_cluster = connects_prev or connects_next
			if in_cluster:
				if cluster_start is None:
					cluster_start = i
				offset_in_cluster = i - cluster_start
				label_yoffs[mixed[i]] = 0.0 if (offset_in_cluster % 2 == 0) else layer_offset
			else:
				cluster_start = None
				label_yoffs[mixed[i]] = 0.0

	# --- NEW: 텍스트 반폭을 각도로 환산(라벨 간 분리 계산용) ---
	def _label_half_deg(self, text, font, r_text, margin_px=4):
		w, _ = font.getsize(text)
		px = (w/2.0) + margin_px
		return (px / float(r_text)) * (180.0 / math.pi)

	def _ellipsize_text_to_width(self, text, font, max_width, suffix=''):
		text = str(text or '')
		try:
			max_width = float(max_width)
		except Exception:
			max_width = 0.0
		if max_width <= 0.0:
			return ''
		if font.getsize(text)[0] <= max_width:
			return text

		if suffix and text.endswith(suffix):
			prefix = text[:-len(suffix)]
			suffix_w, _ = font.getsize(suffix)
			marker_suffix = '...' + suffix
			if suffix_w < max_width and font.getsize(marker_suffix)[0] <= max_width:
				prefix_fit = self._ellipsize_text_to_width(prefix, font, max_width - suffix_w)
				if prefix_fit:
					return prefix_fit.rstrip() + suffix
			# If the suffix itself leaves no useful room, fall through to a
			# normal whole-label fit so the user still sees that text was cut.

		marker = '...'
		if font.getsize(marker)[0] > max_width:
			for count in (2, 1):
				dots = '.' * count
				if font.getsize(dots)[0] <= max_width:
					return dots
			return ''

		lo = 0
		hi = len(text)
		best = marker
		while lo <= hi:
			mid = (lo + hi) // 2
			candidate = text[:mid].rstrip() + marker
			if font.getsize(candidate)[0] <= max_width:
				best = candidate
				lo = mid + 1
			else:
				hi = mid - 1
		return best

	def _fit_outer_word_label_to_bitmap(self, text, font, x, suffix=''):
		w, h = font.getsize(text)
		pad_factor = float(getattr(self, 'OUTER_LABEL_EDGE_PAD_FACTOR', 0.15)) * self._visual_factor('outerLabelEdgePadFactor')
		pad = max(0, int(round(self.symbolSize * pad_factor)))
		left = float(pad)
		right = max(left, float(self.w - pad))
		x = float(x)
		label_right = x + w
		if x >= left and label_right <= right:
			return text, x, w, h

		if x < left and label_right > right:
			max_width = right - left
			fitted = self._ellipsize_text_to_width(text, font, max_width, suffix=suffix)
			fw, fh = font.getsize(fitted) if fitted else (0, h)
			return fitted, left, fw, fh

		if x < left:
			max_width = label_right - left
			fitted = self._ellipsize_text_to_width(text, font, max_width, suffix=suffix)
			fw, fh = font.getsize(fitted) if fitted else (0, h)
			return fitted, label_right - fw, fw, fh

		max_width = right - x
		fitted = self._ellipsize_text_to_width(text, font, max_width, suffix=suffix)
		fw, fh = font.getsize(fitted) if fitted else (0, h)
		return fitted, x, fw, fh

	# --- /NEW ---
	# NEW: 텍스트 박스가 outer wheel(rOuterLine) 안쪽으로 파고들면,
	# 라벨 반지름을 살짝 키워서 항상 바깥쪽으로 유지
	def _ensure_text_outside_outer_wheel(self, rad, x, y, w, h, r_text, pad_px=2):
		(cx, cy) = self.center.Get()
		# 현재 그릴 사각형 꼭짓점들
		corners = [(x, y - h/2), (x + w, y - h/2), (x, y + h/2), (x + w, y + h/2)]
		mind = min(math.hypot(ax - cx, ay - cy) for (ax, ay) in corners)

		target = self.rOuterLine + pad_px  # outer line에서 약간 여유
		if mind >= target:
			return x, y, r_text

		# 필요한 만큼 반지름을 바깥으로 밀기
		delta = target - mind
		new_r = r_text + delta
		new_x = cx + math.cos(rad) * new_r
		new_y = cy + math.sin(rad) * new_r

		# 좌/우 반구 정렬 다시 적용
		pos = util.normalize(math.degrees(rad))
		if 90.0 < pos < 270.0:
			new_x -= w

		return new_x, new_y, new_r

	# --- antiscia / contra-antiscia / dodecatemoria 안전 계산 ---
	def _mk_lon_obj(self, lon):
		class _O: pass
		o = _O()
		o.lon = util.normalize(lon)
		return o

	def _antis_lon(self, lon):
		# Always pass tropical longitude to antiscia.py; do not subtract ayanamsha here
		from antiscia import Antiscia
		C = self.chart2 if (self.chart2 is not None) else self.chart
		ayanopt = getattr(self.options, 'ayanamsha', 0)
		ayan = getattr(C, 'ayanamsha', 0.0)
		antis = Antiscia([], [], [], 0.0, ayanopt, ayan)
		ant, _ = antis.calc(lon)
		return ant

	def _contra_lon(self, lon):
		# Always use antiscia.py logic for contra-antiscia
		from antiscia import Antiscia
		C = self.chart2 if (self.chart2 is not None) else self.chart
		ayanopt = getattr(self.options, 'ayanamsha', 0)
		ayan = getattr(C, 'ayanamsha', 0.0)
		antis = Antiscia([], [], [], 0.0, ayanopt, ayan)
		_, cant = antis.calc(lon)
		return cant

	def _dodec_lon(self, lon):
		# Always pass tropical longitude to antiscia.py; do not subtract ayanamsha here
		from antiscia import Antiscia
		C = self.chart2 if (self.chart2 is not None) else self.chart
		ayanopt = getattr(self.options, 'ayanamsha', 0)
		ayan = getattr(C, 'ayanamsha', 0.0)
		antis = Antiscia([], [], [], 0.0, ayanopt, ayan)
		dodec = antis.calcDodecatemoria(lon)
		return dodec

	def _get_overlay_data(self, kind):
		"""
		kind: 'ANTIS' | 'CANTIS' | 'DODEC'
		chart.antiscia 가 없거나 필드가 None이어도 즉석 계산해서 반환
		반환: (pl_list, lof_obj, [asc_obj, mc_obj])  각각 .lon 속성 보유
		"""
		# chart2(바깥 휠)가 있으면 그것 기준으로, 없으면 chart(안쪽) 기준
		C = self.chart2 if (self.chart2 is not None) else self.chart
		has_antis = getattr(C, "antiscia", None)
		if has_antis is None and hasattr(C, "calcAntiscia"):
			try:
				C.calcAntiscia()
				has_antis = getattr(C, "antiscia", None)
			except Exception:
				has_antis = None

		pl_lons = [C.planets.planets[i].data[planets.Planet.LONG]
				   for i in range(planets.Planets.PLANETS_NUM)]
		lof_lon = C.fortune.fortune[fortune.Fortune.LON]
		asc_lon = C.houses.ascmc[houses.Houses.ASC]
		mc_lon  = C.houses.ascmc[houses.Houses.MC]

		def pick(calc_fn, attr):
			return getattr(has_antis, attr) if (has_antis is not None and hasattr(has_antis, attr)) else calc_fn()

		if kind == 'ANTIS':
			pl = pick(lambda: [self._mk_lon_obj(self._antis_lon(l)) for l in pl_lons], "plantiscia")
			lo = pick(lambda: self._mk_lon_obj(self._antis_lon(lof_lon)),         "lofant")
			am = pick(lambda: [self._mk_lon_obj(self._antis_lon(asc_lon)),
							   self._mk_lon_obj(self._antis_lon(mc_lon))],       "ascmcant")
		elif kind == 'CANTIS':
			pl = pick(lambda: [self._mk_lon_obj(self._contra_lon(l)) for l in pl_lons], "plcontraant")
			lo = pick(lambda: self._mk_lon_obj(self._contra_lon(lof_lon)),            "lofcontraant")
			am = pick(lambda: [self._mk_lon_obj(self._contra_lon(asc_lon)),
							   self._mk_lon_obj(self._contra_lon(mc_lon))],        "ascmccontraant")
		elif kind == 'DODEC':
			pl = pick(lambda: [self._mk_lon_obj(self._dodec_lon(l)) for l in pl_lons], "pldodecatemoria")
			lo = pick(lambda: self._mk_lon_obj(self._dodec_lon(lof_lon)),             "lofdodec")
			am = pick(lambda: [self._mk_lon_obj(self._dodec_lon(asc_lon)),
							   self._mk_lon_obj(self._dodec_lon(mc_lon))],         "ascmcdodec")
		else:
			pl = [self._mk_lon_obj(l) for l in pl_lons]
			lo = self._mk_lon_obj(lof_lon)
			am = [self._mk_lon_obj(asc_lon), self._mk_lon_obj(mc_lon)]

		return pl, lo, am

	def mergefsaspmatrices(self):
		showfss = []
		# Revolution/Election 등에서 fsaspmatrix가 없을 수 있음 → 안전 가드
		if not hasattr(self.chart, 'fsaspmatrix') or self.chart.fsaspmatrix is None:
			return []

		num = len(self.chart.fsaspmatrix)
		for i in range(num):
			ins = False

			num2 = len(self.chart.fsaspmatrix[i][1])
			for j in range(num2):
				b = self.chart.fsaspmatrix[i][1][j]
				body = common.get_chart_planet(self.chart, b)
				if body is None:
					continue
				lon1 = self.chart.fixstars.data[self.chart.fsaspmatrix[i][0]][fixstars.FixStars.LON]
				lon2 = body.data[planets.Planet.LONG]
				showasp = self.isShowAsp(chart.Chart.CONJUNCTIO, lon1, lon2)
				if showasp:
					ins = True
					break

			if ins:
				showfss.append(self.chart.fsaspmatrix[i][0])

		ASC = self.chart.houses.ascmc[houses.Houses.ASC]
		DESC = util.normalize(self.chart.houses.ascmc[houses.Houses.ASC]+180.0)
		MC = self.chart.houses.ascmc[houses.Houses.MC]
		IC = util.normalize(self.chart.houses.ascmc[houses.Houses.MC]+180.0)
		ascmc = [ASC, DESC, MC, IC]
		num = len(self.chart.fsaspmatrixangles)
		for i in range(num):
			num2 = len(self.chart.fsaspmatrixangles[i][1])
			for j in range(num2):
				lon1 = self.chart.fixstars.data[self.chart.fsaspmatrixangles[i][0]][fixstars.FixStars.LON]
				lon2 = ascmc[self.chart.fsaspmatrixangles[i][1][j]]
				showasp = self.isShowAsp(chart.Chart.CONJUNCTIO, lon1, lon2)
				if showasp:
					showfss.append(self.chart.fsaspmatrixangles[i][0])

		if self.options.showfixstarshcs:
			num = len(self.chart.fsaspmatrixhcs)
			for i in range(num):
				num2 = len(self.chart.fsaspmatrixhcs[i][1])
				for j in range(num2):
					lon1 = self.chart.fixstars.data[self.chart.fsaspmatrixhcs[i][0]][fixstars.FixStars.LON]
					lon2 = self.chart.houses.cusps[self.chart.fsaspmatrixhcs[i][1][j]+1]
					showasp = self.isShowAsp(chart.Chart.CONJUNCTIO, lon1, lon2)
					if showasp:
						showfss.append(self.chart.fsaspmatrixhcs[i][0])

		if self.options.showfixstarslof:
			num = len(self.chart.fsaspmatrixlof)
			for i in range(num):
				lon1 = self.chart.fixstars.data[self.chart.fsaspmatrixlof[i]][fixstars.FixStars.LON]
				lon2 = self.chart.fortune.fortune[fortune.Fortune.LON]
				showasp = self.isShowAsp(chart.Chart.CONJUNCTIO, lon1, lon2)
				if showasp:
					showfss.append(self.chart.fsaspmatrixlof[i])

		s = set(showfss)
		showfss = list(s)
		showfss.sort()

		return showfss[:]

	def _get_asteroid_ring_bodies(self):
		asteroid_list = getattr(getattr(self.chart, 'asteroids', None), 'asteroids', None)
		if not asteroid_list:
			return []
		return [body for body in asteroid_list if getattr(body, 'data', None) and len(body.data) >= 4]

	def _get_asteroid_ring_rows(self, asteroid_bodies):
		rows = []
		for body in asteroid_bodies:
			name = getattr(body, 'name', 'Asteroid')
			rows.append([name, name, body.data[0], body.data[1], body.data[2], body.data[3]])
		return rows

	def _is_exact_overlay_conjunction(self, lon1, lon2):
		if not self.isShowAsp(chart.Chart.CONJUNCTIO, lon1, lon2):
			return False
		dist = math.fabs(float(lon1) - float(lon2))
		if dist > 180.0:
			dist = 360.0 - dist
		return dist <= 1.5

	def mergeasteroidconjunctions(self, asteroid_bodies):
		showasteroids = []
		if not asteroid_bodies:
			return showasteroids

		ASC = self.chart.houses.ascmc[houses.Houses.ASC]
		DESC = util.normalize(self.chart.houses.ascmc[houses.Houses.ASC]+180.0)
		MC = self.chart.houses.ascmc[houses.Houses.MC]
		IC = util.normalize(self.chart.houses.ascmc[houses.Houses.MC]+180.0)
		ascmc = [ASC, DESC, MC, IC]

		for idx, asteroid_body in enumerate(asteroid_bodies):
			lon1 = asteroid_body.data[0]
			asteroid_id = getattr(asteroid_body, 'aId', None)
			ins = False

			for body_id in common.get_visible_fixstar_trigger_body_ids(self.chart, self.options):
				if asteroid_id == body_id:
					continue
				body = common.get_chart_planet(self.chart, body_id)
				if body is None:
					continue
				if self._is_exact_overlay_conjunction(lon1, body.data[planets.Planet.LONG]):
					ins = True
					break

			if not ins:
				for lon2 in ascmc:
					if self._is_exact_overlay_conjunction(lon1, lon2):
						ins = True
						break

			if not ins and self.options.showfixstarshcs:
				for cusp_idx in range(houses.Houses.HOUSE_NUM):
					if self._is_exact_overlay_conjunction(lon1, self.chart.houses.cusps[cusp_idx+1]):
						ins = True
						break

			if not ins and self.options.showfixstarslof:
				lon2 = self.chart.fortune.fortune[fortune.Fortune.LON]
				if self._is_exact_overlay_conjunction(lon1, lon2):
					ins = True

			if ins:
				showasteroids.append(idx)

		return showasteroids[:]


	def arrangeyfs(self, fixstrs, fsshift, showfss, rFS):
		(cx, cy) = self.center.Get()

		fsyoffs = []
		num = len(showfss)
		for i in range(num):
			fsyoffs.append(0.0)

		if len(showfss) < 2:
			return fsyoffs[:]

		for j in range(num):
			changed = False
			for i in range(num-1):
				x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-fixstrs[showfss[i]][fixstars.FixStars.LON]-fsshift[i]))*rFS
				y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-fixstrs[showfss[i]][fixstars.FixStars.LON]-fsshift[i]))*rFS
				x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-fixstrs[showfss[i+1]][fixstars.FixStars.LON]-fsshift[i+1]))*rFS
				y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-fixstrs[showfss[i+1]][fixstars.FixStars.LON]-fsshift[i+1]))*rFS
			
				# i 항목 폭
				nom_i = fixstrs[showfss[i]][fixstars.FixStars.NOMNAME]
				raw_i = fixstrs[showfss[i]][fixstars.FixStars.NAME]
				name_i = astrology.display_fixstar_name(nom_i, self.options, raw_i)

				fslon_i = fixstrs[showfss[i]][fixstars.FixStars.LON]
				if self.options.ayanamsha != 0:
					fslon_i = util.normalize(fslon_i - self.chart.ayanamsha)
				(d_i, m_i, s_i) = util.decToDeg(fslon_i)
				label_i = f"{name_i} {d_i%chart.Chart.SIGN_DEG}{self.deg_symbol}{str(m_i).zfill(2)}'"
				w1, h1 = self.fntText.getsize(label_i)

				# i+1 항목 폭
				nom_j = fixstrs[showfss[i+1]][fixstars.FixStars.NOMNAME]
				raw_j = fixstrs[showfss[i+1]][fixstars.FixStars.NAME]
				name_j = astrology.display_fixstar_name(nom_j, self.options, raw_j)

				fslon_j = fixstrs[showfss[i+1]][fixstars.FixStars.LON]
				if self.options.ayanamsha != 0:
					fslon_j = util.normalize(fslon_j - self.chart.ayanamsha)
				(d_j, m_j, s_j) = util.decToDeg(fslon_j)
				label_j = f"{name_j} {d_j%chart.Chart.SIGN_DEG}{self.deg_symbol}{str(m_j).zfill(2)}'"
				w2, h2 = self.fntText.getsize(label_j)

				while (self.overlap(x1, y1+fsyoffs[i], w1, h1, x2, y2+fsyoffs[i+1], w2, h2)):
					if not changed:
						changed = True
					pos = math.degrees(math.pi+math.radians(self._rotation_asc()-fixstrs[showfss[i]][fixstars.FixStars.LON]-fsshift[i]))
					pos = util.normalize(pos)
					deglim = 25.0
					if pos > 90.0-deglim and pos < 270.0-deglim:
						fsyoffs[i+1] += 1.0
					else:
						fsyoffs[i+1] -= 1.0

					# i 재계산
					nom_i = fixstrs[showfss[i]][fixstars.FixStars.NOMNAME]
					raw_i = fixstrs[showfss[i]][fixstars.FixStars.NAME]
					name_i = astrology.display_fixstar_name(nom_i, self.options, raw_i)
					fslon_i = fixstrs[showfss[i]][fixstars.FixStars.LON]
					if self.options.ayanamsha != 0:
						fslon_i = util.normalize(fslon_i - self.chart.ayanamsha)
					(d_i, m_i, s_i) = util.decToDeg(fslon_i)
					label_i = f"{name_i} {d_i%chart.Chart.SIGN_DEG}{self.deg_symbol}{str(m_i).zfill(2)}'"
					w1, h1 = self.fntText.getsize(label_i)

					# i+1 재계산
					nom_j = fixstrs[showfss[i+1]][fixstars.FixStars.NOMNAME]
					raw_j = fixstrs[showfss[i+1]][fixstars.FixStars.NAME]
					name_j = astrology.display_fixstar_name(nom_j, self.options, raw_j)
					fslon_j = fixstrs[showfss[i+1]][fixstars.FixStars.LON]
					if self.options.ayanamsha != 0:
						fslon_j = util.normalize(fslon_j - self.chart.ayanamsha)
					(d_j, m_j, s_j) = util.decToDeg(fslon_j)
					label_j = f"{name_j} {d_j%chart.Chart.SIGN_DEG}{self.deg_symbol}{str(m_j).zfill(2)}'"
					w2, h2 = self.fntText.getsize(label_j)

			if not changed:
				break
					
		return fsyoffs[:]


	def arrangefs(self, fixstrs, showfss, rFS):
		'''Arranges fixstars so they won't overlap each other'''

		fsshift = []
		num = len(showfss)
		for i in range(num):
			fsshift.append(0.0)

		if len(showfss) < 2:
			return fsshift[:]

		#doFSArrange arranges consecutive two fixstars only(0 and 1, 1 and 2, ...), this is why we need to do it num+1 times
		for i in range(num+1):
			self.doFSArrange(num, fixstrs, showfss, fsshift, rFS)

		#Arrange 360-0 transition also
		#We only shift forward at 360-0
		shifted = self.doFSShift(num-1, 0, fixstrs, showfss, fsshift, rFS, True)

		if shifted:
			for i in range(num):
				self.doFSArrange(num, fixstrs, showfss, fsshift, rFS, True)
		#check if beyond (not overlapping but beyond)
		else:
			if fixstrs[showfss[num-1]][fixstars.FixStars.LON] > 300.0 and fixstrs[showfss[0]][fixstars.FixStars.LON] < 60.0:
				lon1 = fixstrs[showfss[num-1]][fixstars.FixStars.LON]+fsshift[num-1]
				lon2 = fixstrs[showfss[0]][fixstars.FixStars.LON]+360.0+fsshift[0]

				if lon1 > lon2:
					dist = lon1-lon2
					fsshift[0] += dist
					self.doFSShift(num-1, 0, fixstrs, showfss, fsshift, rFS, True)

					for i in range(num-1):
						lon1 = fixstrs[showfss[i]][fixstars.FixStars.LON]+fsshift[i]
						lon2 = fixstrs[showfss[i+1]][fixstars.FixStars.LON]+fsshift[i+1]	
						if lon1 < 180.0 and lon2 < 180.0:
							if lon1 > lon2:
								dist = lon1-lon2
								fsshift[i+1] += dist
								self.doFSShift(i, i+1, fixstrs, showfss, fsshift, rFS, True)
							else:
								break
						else:
							break

					for i in range(num):
						self.doFSArrange(num, fixstrs, showfss, fsshift, rFS, True)

		return fsshift[:]


	def doFSArrange(self, num, fixstrs, showfss, fsshift, rFS, forward = False):
		shifted = False

		for i in range(num-1):
			shifted = self.doFSShift(i, i+1, fixstrs, showfss, fsshift, rFS, forward)

		if shifted:
			self.doFSArrange(num, fixstrs, showfss, fsshift, rFS, forward)


	def doFSShift(self, f1, f2, fixstrs, showfss, fsshift, rFS, forward = False):
		(cx, cy) = self.center.Get()
		shifted = False

		x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-fixstrs[showfss[f1]][fixstars.FixStars.LON]-fsshift[f1]))*rFS
		y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-fixstrs[showfss[f1]][fixstars.FixStars.LON]-fsshift[f1]))*rFS
		x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-fixstrs[showfss[f2]][fixstars.FixStars.LON]-fsshift[f2]))*rFS
		y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-fixstrs[showfss[f2]][fixstars.FixStars.LON]-fsshift[f2]))*rFS

		#this is different between fixstars and planets
		# --- FIXSTARS도 라벨 실제 폭/높이로 겹침 판정(Arabic Parts와 동일 개념) ---
		def _fs_label_wh(idx):
			nom = fixstrs[showfss[idx]][fixstars.FixStars.NOMNAME]
			raw = fixstrs[showfss[idx]][fixstars.FixStars.NAME]
			name = astrology.display_fixstar_name(nom, self.options, raw)
			lon  = fixstrs[showfss[idx]][fixstars.FixStars.LON]
			if self.options.ayanamsha != 0:
				lon = util.normalize(lon - self.chart.ayanamsha)
			(d, m, s) = util.decToDeg(lon)
			label = f"{name} {d % chart.Chart.SIGN_DEG}{self.deg_symbol}{str(m).zfill(2)}'"
			return self.fntText.getsize(label)

		w1, h1 = _fs_label_wh(f1)
		w2, h2 = _fs_label_wh(f2)

		def _xy(idx, shift):
			ang = math.pi + math.radians(self._rotation_asc()
										- fixstrs[showfss[idx]][fixstars.FixStars.LON]
										- shift)
			return (cx + math.cos(ang) * rFS, cy + math.sin(ang) * rFS,
					util.normalize(math.degrees(ang)))

		x1, y1, pos1 = _xy(f1, fsshift[f1])
		x2, y2, pos2 = _xy(f2, fsshift[f2])
		if 90.0 < pos1 < 270.0:
			x1 -= w1
		if 90.0 < pos2 < 270.0:
			x2 -= w2

		while self.overlap(x1, y1, w1, h1, x2, y2, w2, h2):
			if not forward:
				fsshift[f1] -= 0.1
			fsshift[f2] += 0.1

			# 재계산(각도/정렬 포함)
			x1, y1, pos1 = _xy(f1, fsshift[f1])
			x2, y2, pos2 = _xy(f2, fsshift[f2])
			if 90.0 < pos1 < 270.0:
				x1 -= w1
			if 90.0 < pos2 < 270.0:
				x2 -= w2

			if not shifted:
				shifted = True

		return shifted

		class _LonOnly:
			def __init__(self, lon):
				self.lon = util.normalize(lon)

	def _dodec_from_lon_with_ayan(self, lon):
		ayan = self.chart.ayanamsha if self.options.ayanamsha != 0 else 0.0
		sid  = util.normalize(lon - ayan)
		s    = int(sid / chart.Chart.SIGN_DEG)
		d    = sid - s * chart.Chart.SIGN_DEG
		return util.normalize(s * chart.Chart.SIGN_DEG + d * 12.0)

	def _build_dodec_overlay(self, C):
		# C: chart 또는 chart2
		pl = []
		for i in range(planets.Planets.PLANETS_NUM):
			lon = C.planets.planets[i].data[planets.Planet.LONG]
			pl.append(_LonOnly(self._dodec_from_lon_with_ayan(lon)))

		lof_lon = C.fortune.fortune[fortune.Fortune.LON]
		lof     = _LonOnly(self._dodec_from_lon_with_ayan(lof_lon))

		asc_lon = C.houses.ascmc[houses.Houses.ASC]
		mc_lon  = C.houses.ascmc[houses.Houses.MC]
		am      = [
			_LonOnly(self._dodec_from_lon_with_ayan(asc_lon)),
			_LonOnly(self._dodec_from_lon_with_ayan(mc_lon))
		]
		return (pl, lof, am)

	def _ensure_ap_for_chart(self, C):
		try:
			if not (hasattr(C, 'parts') and C.parts and getattr(C.parts, 'parts', None)):
				if hasattr(C, 'calcArabicParts'):
					C.calcArabicParts()
				else:
					# calcArabicParts가 없거나 parts가 여전히 비어 있으면 직접 생성
					try:
						# arabicparts 모듈은 이미 본 파일에서 참조 중
						C.parts = arabicparts.ArabicParts(C, self.options)
					except Exception:
						C.parts = None

		except Exception:
			pass

	def arrangeAntis(self, plnts, lof, ascmc, rPlanet):
		'''Arranges antiscia of planets so they won't overlap each other'''

		pls = []
		pshift = []
		order = []
		mixed = []

		for i in range (planets.Planets.PLANETS_NUM+3):#planets(with descNode), lof and ascmc
			pls.append(0.0)
			pshift.append(0.0)
			order.append(0)
			mixed.append(0)

		pnum = 0
		for i in range (planets.Planets.PLANETS_NUM+3):
			if i < planets.Planets.PLANETS_NUM:
				pls[pnum] = plnts[i].lon
			elif i == planets.Planets.PLANETS_NUM:
				pls[pnum] = lof.lon
			elif i == planets.Planets.PLANETS_NUM+1:
				pls[pnum] = ascmc[0].lon
			elif i == planets.Planets.PLANETS_NUM+2:
				pls[pnum] = ascmc[1].lon

			if (i == astrology.SE_URANUS and not self.options.transcendental[chart.Chart.TRANSURANUS]) or (i == astrology.SE_NEPTUNE and not self.options.transcendental[chart.Chart.TRANSNEPTUNE]) or (i == astrology.SE_PLUTO and not self.options.transcendental[chart.Chart.TRANSPLUTO]) or ((i == astrology.SE_MEAN_NODE or i == astrology.SE_TRUE_NODE) and not self.options.shownodes) or (i == planets.Planets.PLANETS_NUM and not self.options.showlof):
				continue
			mixed[pnum] = i
			pnum += 1

		#arrange in order, initialize
		for i in range(pnum):
			order[i] = pls[i]
			
		for j in range(pnum):
			for i in range(pnum-1):
				if (order[i] > order[i+1]):
					tmp = order[i]
					order[i] = order[i+1]
					order[i+1] = tmp
					tmp = mixed[i]
					mixed[i] = mixed[i+1]
					mixed[i+1] = tmp
		
		#doArrange arranges consecutive two planets only(0 and 1, 1 and 2, ...), this is why we need to do it pnum+1 times
		for i in range(pnum+1):
			self.doArrangeAntis(pnum, pshift, order, mixed, rPlanet)

		#Arrange 360-0 transition also
		#We only shift forward at 360-0
		shifted = self.doShiftAntis(pnum-1, 0, pshift, order, mixed, rPlanet, True)

		if shifted:
			for i in range(pnum):
				self.doArrange(pnum, pshift, order, mixed, rPlanet, True)
		#check if beyond (not overlapping but beyond)
		else:
			if order[pnum-1] > 300.0 and order[0] < 60.0:
				lon1 = order[pnum-1]+pshift[mixed[pnum-1]]
				lon2 = order[0]+360.0+pshift[mixed[0]]

				if lon1 > lon2:
					dist = lon1-lon2
					pshift[mixed[0]] += dist
					self.doShiftAntis(pnum-1, 0, pshift, order, mixed, rPlanet, True)

					for i in range(pnum-1):
						lon1 = order[i]+pshift[mixed[i]]
						lon2 = order[i+1]+pshift[mixed[i+1]]	
						if lon1 < 180.0 and lon2 < 180.0:
							if lon1 > lon2:
								dist = lon1-lon2
								pshift[mixed[i+1]] += dist
								self.doShiftAntis(i, i+1, pshift, order, mixed, rPlanet, True)
							else:
								break
						else:
							break

					for i in range(pnum):
						self.doArrangeAntis(pnum, pshift, order, mixed, rPlanet, True)

		return pshift[:]


	def doArrangeAntis(self, pnum, pshift, order, mixed, rPlanet, forward = False):
		shifted = False

		for i in range(pnum-1):
			shifted = self.doShiftAntis(i, i+1, pshift, order, mixed, rPlanet, forward)

		if shifted:
			self.doArrangeAntis(pnum, pshift, order, mixed, rPlanet, forward)


	def doShiftAntis(self, p1, p2, pshift, order, mixed, rPlanet, forward = False):
		(cx, cy) = self.center.Get()
		shifted = False

		x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-order[p1]-pshift[mixed[p1]]))*rPlanet
		y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-order[p1]-pshift[mixed[p1]]))*rPlanet
		x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-order[p2]-pshift[mixed[p2]]))*rPlanet
		y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-order[p2]-pshift[mixed[p2]]))*rPlanet

		w1, h1 = 0.0, 0.0
		if mixed[p1] < planets.Planets.PLANETS_NUM:
			w1, h1 = self.fntMorinus.getsize(common.common.Planets[mixed[p1]])
		elif mixed[p1] == planets.Planets.PLANETS_NUM:
			w1, h1 = self.fntMorinus.getsize(common.common.fortune)
		elif mixed[p1] == planets.Planets.PLANETS_NUM+1:
			w1, h1 = self.fntAntisText.getsize(mtexts.txts['StripAsc'])
		elif mixed[p1] == planets.Planets.PLANETS_NUM+2:
			w1, h1 = self.fntAntisText.getsize(mtexts.txts['StripMC'])

		w2, h2 = 0.0, 0.0
		if mixed[p2] < planets.Planets.PLANETS_NUM:
			w2, h2 = self.fntMorinus.getsize(common.common.Planets[mixed[p2]])
		elif mixed[p2] == planets.Planets.PLANETS_NUM:
			w2, h2 = self.fntMorinus.getsize(common.common.fortune)
		elif mixed[p2] == planets.Planets.PLANETS_NUM+1:
			w2, h2 = self.fntAntisText.getsize(mtexts.txts['StripAsc'])
		elif mixed[p2] == planets.Planets.PLANETS_NUM+2:
			w2, h2 = self.fntAntisText.getsize(mtexts.txts['StripMC'])

		while (self.overlap(x1, y1, w1, h1, x2, y2, w2, h2)):
			if not forward:
				pshift[mixed[p1]] -= 0.1
			pshift[mixed[p2]] += 0.1

			x1 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-order[p1]-pshift[mixed[p1]]))*rPlanet
			y1 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-order[p1]-pshift[mixed[p1]]))*rPlanet
			x2 = cx+math.cos(math.pi+math.radians(self._rotation_asc()-order[p2]-pshift[mixed[p2]]))*rPlanet
			y2 = cy+math.sin(math.pi+math.radians(self._rotation_asc()-order[p2]-pshift[mixed[p2]]))*rPlanet

			if not shifted:
				shifted = True

		return shifted


	def isShowAsp(self, typ, lon1, lon2):
		res = False

		if typ != chart.Chart.NONE and self.options.aspect[typ]:
			val = True
			#check traditional aspects
			if self.options.traditionalaspects:
				if not(typ == chart.Chart.CONJUNCTIO or typ == chart.Chart.SEXTIL or typ == chart.Chart.QUADRAT or typ == chart.Chart.TRIGON or typ == chart.Chart.OPPOSITIO):
					val = False
				else:
					lona1 = lon1
					lona2 = lon2
					if self.options.ayanamsha != 0:
						lona1 -= self.chart.ayanamsha
						lona1 = util.normalize(lona1)
						lona2 -= self.chart.ayanamsha
						lona2 = util.normalize(lona2)

					sign1 = int(lona1/chart.Chart.SIGN_DEG)
					sign2 = int(lona2/chart.Chart.SIGN_DEG)
					signdiff = math.fabs(sign1-sign2)
					#check pisces-aries transition
					if signdiff > chart.Chart.SIGN_NUM/2:
						signdiff = chart.Chart.SIGN_NUM-signdiff#!?
					if self.arsigndiff[typ] != signdiff:
						val = False

			res = val

		return res


	def isExact(self, exact, lon1, lon2):
		res = False

		if self.options.traditionalaspects:
			lona1 = lon1
			lona2 = lon2
			if self.options.ayanamsha != 0:
				lona1 -= self.chart.ayanamsha
				lona1 = util.normalize(lona1)
				lona2 -= self.chart.ayanamsha
				lona2 = util.normalize(lona2)
			deg1 = int(lona1%chart.Chart.SIGN_DEG)
			deg2 = int(lona2%chart.Chart.SIGN_DEG)
			if deg1 == deg2:
				res = True
		else:
			if exact:
				res = True

		return res

	def drawOuterFortuneLine(self, C=None):
		C = C or self.chart

		if not (C and getattr(C, "fortune", None)):
			return
		try:
			lon = C.fortune.fortune[fortune.Fortune.LON]
		except Exception:
			return

		(cx, cy) = self.center.Get()
		clr = self.options.clrframe if not self.bw else (0, 0, 0)
		w = self._scaled_line_w(2 * self._visual_factor('mediumStrokeBase'))
		pen = wx.Pen(clr, w)
		self.bdc.SetPen(pen)

		base  = util.normalize(self._rotation_asc() - lon)
		shift = float(getattr(self, "_fortune_outer_shift", 0.0))

		rad_in  = math.pi + math.radians(base)                        # r30: 원래 황경
		rad_out = math.pi + math.radians(util.normalize(base + shift))# rOuterLine: 라벨 각

		x1 = cx + math.cos(rad_in)  * self.r30
		y1 = cy + math.sin(rad_in)  * self.r30
		x2 = cx + math.cos(rad_out) * self.rOuterLine
		y2 = cy + math.sin(rad_out) * self.rOuterLine
		self.bdc.DrawLine(x1, y1, x2, y2)

	def drawSurveilMarks(self):
		"""Render global Surveil study marks at captured zodiacal longitudes."""
		marks = getattr(self, 'surveil_marks', None)
		if not marks:
			return
		(cx, cy) = self.center.Get()
		r_wheel = getattr(self, 'r30', self.maxradius * 0.85)
		tick_min = 5 * self._visual_factor('surveilTickLengthMin')
		tick_scale = 0.42 * self._visual_factor('surveilTickLengthScale')
		r_outer = getattr(self, 'rOuterLine', r_wheel + max(tick_min, self.symbolSize * tick_scale))
		if self.bw:
			accent = (0, 0, 0)
		else:
			bg = getattr(self.options, 'clrbackground', None)
			try:
				is_dark = (int(bg[0]) + int(bg[1]) + int(bg[2])) / 3 < 128
			except Exception:
				is_dark = False
			accent = _tokens.SURVEIL_ACCENT_DARK_RGB if is_dark else _tokens.SURVEIL_ACCENT_LIGHT_RGB
		line_w = self._hairline_width()
		tick_len = max(int(round(tick_min)), int(round(self.symbolSize * tick_scale)))
		r_tick_end = max(r_outer, r_wheel + tick_len)
		glyph_gap = max(
			int(round(2 * self._visual_factor('surveilGlyphGapMin'))),
			int(round(self.symbolSize * 0.12 * self._visual_factor('surveilGlyphGapScale'))),
		)
		try:
			glyph_size = max(
				int(round(5 * self._visual_factor('surveilGlyphSizeMin'))),
				int(round(self.symbolSize * 0.34 * self._dpi_scale * self._visual_factor('surveilGlyphSizeScale'))),
			)
		except Exception:
			glyph_size = max(
				int(round(5 * self._visual_factor('surveilGlyphSizeMin'))),
				int(round(self.symbolSize * 0.34 * self._visual_factor('surveilGlyphSizeScale'))),
			)
		surveil_morinus = wxcompat.VectorFont(wxcompat.MORINUS_BUNDLED_FACE, glyph_size)
		text_face = getattr(common.common, 'abc_face', 'FreeSans')
		surveil_text = wxcompat.VectorFont(text_face, glyph_size)
		label_gap = max(
			int(round(2 * self._visual_factor('surveilLabelGapMin'))),
			int(round(self.symbolSize * 0.08 * self._visual_factor('surveilLabelGapScale'))),
		)
		for mark in marks:
			if not isinstance(mark, dict):
				continue
			if not mark.get('enabled', True):
				continue
			try:
				lon = float(mark.get('longitude'))
			except (TypeError, ValueError):
				continue
			if not math.isfinite(lon):
				continue
			ang = math.pi + math.radians(self._rotation_asc() - lon)
			x1 = cx + math.cos(ang) * r_wheel
			y1 = cy + math.sin(ang) * r_wheel
			x2 = cx + math.cos(ang) * r_tick_end
			y2 = cy + math.sin(ang) * r_tick_end
			pen = wx.Pen(accent, line_w)
			self.bdc.SetPen(pen)
			self.bdc.DrawLine(x1, y1, x2, y2)
			glyph = str(mark.get('glyph') or '').strip()
			label = str(mark.get('label') or '').strip()
			marker_text = glyph
			marker_font = surveil_morinus if mark.get('glyph_font') == 'morinus' else surveil_text
			if not marker_text:
				marker_text = label.split(' (', 1)[0].strip() or 'Marker'
				marker_font = surveil_text
			if len(marker_text) > 18:
				marker_text = marker_text[:17] + '...'
			source_name = str(mark.get('source_name') or '').strip()
			if len(source_name) > 18:
				source_name = source_name[:17] + '...'
			source_text = ' (%s)' % source_name if source_name else ''
			try:
				gw, gh = marker_font.getsize(marker_text)
			except Exception:
				gw, gh = self.symbolSize * 0.28, self.symbolSize * 0.28
			if source_text:
				try:
					tw, th = surveil_text.getsize(source_text)
				except Exception:
					tw, th = self.symbolSize * 0.8, self.symbolSize * 0.28
			else:
				tw, th = 0, 0
			total_w = gw + (label_gap if source_text else 0) + tw
			total_h = max(gh, th)
			r_label = r_tick_end + glyph_gap
			ax = cx + math.cos(ang) * r_label
			ay = cy + math.sin(ang) * r_label
			cos_a = math.cos(ang)
			sin_a = math.sin(ang)
			if cos_a > 0.25:
				left = ax
			elif cos_a < -0.25:
				left = ax - total_w
			else:
				left = ax - total_w / 2.0
			top = ay - total_h / 2.0
			marker_top = top + (total_h - gh) / 2.0
			self.draw.text((left, marker_top), marker_text, fill=accent, font=marker_font)
			if source_text:
				text_top = top + (total_h - th) / 2.0
				self.draw.text((left + gw + label_gap, text_top), source_text, fill=accent, font=surveil_text)
			try:
				display_lon = util.normalize(lon - self.chart.ayanamsha) if self.options.ayanamsha != 0 else lon
			except Exception:
				display_lon = lon
			self._register_hover_region(
				'secondary_ring',
				mark.get('id') or mark.get('label') or lon,
				left,
				top,
				total_w,
				total_h,
				chart_role='primary',
				priority=48,
				data={
					'family': 'surveil',
					'title': mark.get('label') or 'Marker',
					'longitude': lon,
					'display_lon': display_lon,
					'colour': accent,
					'glyph': glyph,
					'glyph_font': mark.get('glyph_font'),
					'source_name': mark.get('source_name', ''),
					'study_name': mark.get('study_name', ''),
				},
			)

	def arrangeyParts(self, parts, showidxs, fshift, rText):
		"""
		항성의 arrangeyfs와 동일한 요령:
		- 이웃 라벨끼리 겹치면 좌반구/우반구에 따라 위/아래로 1px씩 쌓아 올림
		"""
		import math
		(cx, cy) = self.center.Get()
		n = len(showidxs)
		yoffs = [0.0] * n
		if n < 2:
			return yoffs[:]

		def rect(i):
			idx  = showidxs[i]
			name = parts[idx][arabicparts.ArabicParts.NAME]
			lon  = parts[idx][arabicparts.ArabicParts.LONG]
			ang  = util.normalize(self._rotation_asc() - lon - fshift[i])
			rad  = math.pi + math.radians(ang)
			x    = cx + math.cos(rad) * rText
			y    = cy + math.sin(rad) * rText
			w, h = self.fntText.getsize(name)
			pad = max(1, int(self.symbolSize * 0.2))  
			w  += pad
			h  += pad
			pos  = util.normalize(math.degrees(rad))
			if 90.0 < pos < 270.0:
				x -= w
			return (x, y - h/2.0 + yoffs[i], w, h, pos)

		for _ in range(n):
			changed = False
			for i in range(n-1):
				x1, y1, w1, h1, pos1 = rect(i)
				x2, y2, w2, h2, pos2 = rect(i+1)
				while self.overlap(x1, y1, w1, h1, x2, y2, w2, h2):
					changed = True
					# 좌반구(텍스트 오른쪽 정렬)는 아래로(+), 우반구는 위로(-) 살짝 이동
					if 90.0 < pos2 < 270.0:
						yoffs[i+1] += 1.0
					else:
						yoffs[i+1] -= 1.0
					x1, y1, w1, h1, pos1 = rect(i)
					x2, y2, w2, h2, pos2 = rect(i+1)
			if not changed:
				break

		return yoffs[:]
