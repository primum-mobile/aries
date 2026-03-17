# -*- coding: utf-8 -*-
import os
import math
import wx
import Image, ImageDraw, ImageFont
import common
import astrology
import chart
import houses
import fortune
import primdirs
import pdsinchart
import pdsinchartstepperdlg
import pdsinchartframe
import pdsinchartingressframe
import pdsinchartdlgopts
import fixstars
import mtexts
import util
import re
import windowbehavior
import threading
import chart_session


def _compute_celestial_pd_chart(radix, da, options):
	"""Compute a celestial (non-terrestrial) PD-in-chart from signed arc *da* (degrees).
	Mirrors the calculation in PDsInChartStepperDlg.onShowBtn for the non-terrestrial path.
	"""
	pdinch = pdsinchart.PDsInChart(radix, da)
	pdh, pdm, pds_ = util.decToDeg(pdinch.tz)
	cal = chart.Time.GREGORIAN
	if radix.time.cal == chart.Time.JULIAN:
		cal = chart.Time.JULIAN
	tim = chart.Time(pdinch.yz, pdinch.mz, pdinch.dz, pdh, pdm, pds_,
					 radix.time.bc, cal, chart.Time.GREENWICH,
					 True, 0, 0, False, radix.place, False)
	pl = options.primarydir
	if options.pdincharttyp == pdsinchartdlgopts.PDsInChartsDlgOpts.FROMMUNDANEPOS:
		pdchart = chart.Chart(radix.name, radix.male, tim, radix.place, chart.Chart.PDINCHART, '', options, False)
		pdchartpls = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PDINCHART, '', options, False)
		if pl in (primdirs.PrimDirs.PLACIDIANSEMIARC, primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE):
			pdchart.planets.calcMundaneProfPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, radix.place.lat, radix.obl[0])
		else:
			pdchart.houses = houses.Houses(tim.jd, 0, pdchart.place.lat, pdchart.place.lon, 'R', pdchart.obl[0], options.ayanamsha, pdchart.ayanamsha)
			pdchart.planets.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, radix.place.lat, radix.obl[0])
		if pl in (primdirs.PrimDirs.PLACIDIANSEMIARC, primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE):
			pdchart.fortune.calcMundaneProfPos(pdchart.houses.ascmc2, pdchartpls.fortune, radix.place.lat, radix.obl[0])
		else:
			pdchart.fortune.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.fortune, radix.place.lat, radix.obl[0])
	elif options.pdincharttyp == pdsinchartdlgopts.PDsInChartsDlgOpts.FROMZODIACALPOS:
		pdchart = chart.Chart(radix.name, radix.male, tim, radix.place, chart.Chart.PDINCHART, '', options, False, chart.Chart.YEAR, True)
		pdchartpls = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PDINCHART, '', options, False, chart.Chart.YEAR, True)
		if pl in (primdirs.PrimDirs.PLACIDIANSEMIARC, primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE):
			pdchart.planets.calcMundaneProfPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, radix.place.lat, radix.obl[0])
		else:
			pdchart.houses = houses.Houses(tim.jd, 0, pdchart.place.lat, pdchart.place.lon, 'R', pdchart.obl[0], options.ayanamsha, pdchart.ayanamsha)
			pdchart.planets.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, radix.place.lat, radix.obl[0])
		if pl in (primdirs.PrimDirs.PLACIDIANSEMIARC, primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE):
			pdchart.fortune.calcMundaneProfPos(pdchart.houses.ascmc2, pdchartpls.fortune, radix.place.lat, radix.obl[0])
		else:
			pdchart.fortune.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.fortune, radix.place.lat, radix.obl[0])
	else:  # Full Astronomical Procedure
		pdchart = chart.Chart(radix.name, radix.male, tim, radix.place, chart.Chart.PDINCHART, '', options, False)
		pdchartpls = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PDINCHART, '', options, False)
		pdpls = pdchartpls.planets.planets
		if options.pdinchartsecmotion:
			pdpls = pdchart.planets.planets
		raequasc, declequasc, dist = astrology.swe_cotrans(pdchart.houses.ascmc[houses.Houses.EQUASC], 0.0, 1.0, -radix.obl[0])
		pdchart.planets.calcFullAstronomicalProc(da, radix.obl[0], pdpls, pdchart.place.lat, pdchart.houses.ascmc2, raequasc)
		pdchart.fortune.calcFullAstronomicalProc(pdchartpls.fortune, da, radix.obl[0])
	pdchart._pd_arc_signed = float(da)
	pdchart._pd_arc_abs = math.fabs(float(da))
	pdchart._pd_direct = (da >= 0.0)
	pdchart._pd_exact_event = None
	return pdchart


def _attach_pd_exact_event(chrt, pd):
	if chrt is None:
		return
	if pd is None:
		chrt._pd_exact_event = None
		return
	prom_glyph, sig_glyph, promasp_glyph, sigasp_glyph, dir_glyph = _pd_exact_table_glyphs(pd)
	mid_aspect_glyph = _pd_mid_aspect_glyph_table(pd)
	prom_font = _pd_prom_font_kind_table(pd)
	sig_font = _pd_sig_font_kind_table(pd)
	aspect_font = _pd_aspect_font_kind_table(pd)
	chrt._pd_exact_event = {
		'prom': pd.prom,
		'prom2': pd.prom2,
		'sig': pd.sig,
		'promasp': pd.promasp,
		'sigasp': pd.sigasp,
		'mundane': pd.mundane,
		'direct': pd.direct,
		'arc': pd.arc,
		'time': pd.time,
		'prom_glyph': prom_glyph,
		'sig_glyph': sig_glyph,
		'promasp_glyph': promasp_glyph,
		'sigasp_glyph': sigasp_glyph,
		'mid_aspect_glyph': mid_aspect_glyph,
		'dir_glyph': dir_glyph,
		'prom_font': prom_font,
		'sig_font': sig_font,
		'aspect_font': aspect_font,
	}


def _pd_mid_aspect_glyph_table(pd):
	if pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
		return 'RX'
	if pd.sigasp == chart.Chart.PARALLEL:
		return 'X'
	if pd.sigasp == chart.Chart.CONTRAPARALLEL:
		if pd.parallelaxis == 0:
			return 'Y'
		return 'X'
	if pd.promasp == chart.Chart.MIDPOINT:
		return ''
	if 0 <= pd.promasp < len(common.common.Aspects):
		return common.common.Aspects[pd.promasp]
	if 0 <= pd.sigasp < len(common.common.Aspects):
		return common.common.Aspects[pd.sigasp]
	return ''


def _pd_prom_font_kind_table(pd):
	if pd.promasp == chart.Chart.MIDPOINT or pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
		return 'symbol'
	if pd.prom >= primdirs.PrimDir.ANTISCION and pd.prom < primdirs.PrimDir.TERM:
		if pd.prom == primdirs.PrimDir.ANTISCIONASC or pd.prom == primdirs.PrimDir.CONTRAANTASC:
			return 'text'
		if pd.prom == primdirs.PrimDir.ANTISCIONMC or pd.prom == primdirs.PrimDir.CONTRAANTMC:
			return 'text'
		return 'symbol'
	if pd.prom >= primdirs.PrimDir.TERM and pd.prom < primdirs.PrimDir.FIXSTAR:
		return 'symbol'
	if pd.prom >= primdirs.PrimDir.FIXSTAR:
		return 'text'
	if pd.prom == primdirs.PrimDir.LOF:
		return 'symbol'
	if pd.prom == primdirs.PrimDir.CUSTOMERPD:
		return 'text'
	if pd.prom == primdirs.PrimDir.ASC or pd.prom == primdirs.PrimDir.MC:
		return 'text'
	if pd.prom >= primdirs.PrimDir.HC2 and pd.prom < primdirs.PrimDir.LOF:
		return 'text'
	return 'symbol'


def _pd_sig_font_kind_table(pd):
	if pd.sigasp == chart.Chart.PARALLEL or pd.sigasp == chart.Chart.CONTRAPARALLEL:
		return 'symbol'
	if pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
		return 'text'
	if pd.sig == primdirs.PrimDir.LOF:
		return 'symbol'
	if pd.sig == primdirs.PrimDir.SYZ or pd.sig == primdirs.PrimDir.CUSTOMERPD:
		return 'text'
	if pd.sig >= primdirs.PrimDir.OFFSANGLES and pd.sig < primdirs.PrimDir.LOF:
		return 'text'
	return 'symbol'


def _pd_aspect_font_kind_table(pd):
	if pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
		return 'text'
	return 'symbol'


def _pd_exact_table_glyphs(pd):
	prom_glyph = _pd_prom_glyph_table(pd)
	sig_glyph = _pd_sig_glyph_table(pd)
	promasp_glyph = _pd_prom_aspect_glyph_table(pd)
	sigasp_glyph = _pd_sig_aspect_glyph_table(pd)
	dir_glyph = mtexts.txts['D'] if pd.direct else mtexts.txts['C']
	return prom_glyph, sig_glyph, promasp_glyph, sigasp_glyph, dir_glyph


def _pd_prom_aspect_glyph_table(pd):
	if pd.promasp == chart.Chart.MIDPOINT or pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
		return ''
	if pd.prom >= primdirs.PrimDir.TERM and pd.prom < primdirs.PrimDir.FIXSTAR:
		return ''
	if pd.prom >= primdirs.PrimDir.FIXSTAR:
		return ''
	if pd.prom == primdirs.PrimDir.LOF or pd.prom == primdirs.PrimDir.CUSTOMERPD:
		return ''
	if pd.prom >= primdirs.PrimDir.HC2 and pd.prom < primdirs.PrimDir.LOF:
		return ''
	if pd.promasp == chart.Chart.CONJUNCTIO:
		return ''
	if 0 <= pd.promasp < len(common.common.Aspects):
		return common.common.Aspects[pd.promasp]
	return ''


def _pd_sig_aspect_glyph_table(pd):
	if pd.sigasp == chart.Chart.PARALLEL:
		return 'X'
	if pd.sigasp == chart.Chart.CONTRAPARALLEL:
		if pd.parallelaxis == 0:
			return 'Y'
		return 'X'
	if pd.sigasp == chart.Chart.RAPTPAR:
		return 'RX'
	if pd.sigasp == chart.Chart.RAPTCONTRAPAR:
		return 'RX'
	if pd.sig == primdirs.PrimDir.LOF:
		if pd.mundane and 0 <= pd.sigasp < len(common.common.Aspects):
			return common.common.Aspects[pd.sigasp]
		return ''
	if pd.sig == primdirs.PrimDir.SYZ or pd.sig == primdirs.PrimDir.CUSTOMERPD:
		return ''
	if pd.sig >= primdirs.PrimDir.OFFSANGLES and pd.sig < primdirs.PrimDir.LOF:
		return ''
	if pd.sigasp == chart.Chart.CONJUNCTIO:
		return ''
	if 0 <= pd.sigasp < len(common.common.Aspects):
		return common.common.Aspects[pd.sigasp]
	return ''


def _pd_prom_glyph_table(pd):
	if pd.promasp == chart.Chart.MIDPOINT or pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
		if 0 <= pd.prom < len(common.common.Planets):
			if 0 <= pd.prom2 < len(common.common.Planets):
				return common.common.Planets[pd.prom] + ' ' + common.common.Planets[pd.prom2]
			return common.common.Planets[pd.prom]
		return ''
	if pd.prom >= primdirs.PrimDir.ANTISCION and pd.prom < primdirs.PrimDir.TERM:
		if pd.prom == primdirs.PrimDir.ANTISCIONLOF or pd.prom == primdirs.PrimDir.CONTRAANTLOF:
			return common.common.fortune
		if pd.prom == primdirs.PrimDir.ANTISCIONASC or pd.prom == primdirs.PrimDir.CONTRAANTASC:
			return mtexts.txts['Asc']
		if pd.prom == primdirs.PrimDir.ANTISCIONMC or pd.prom == primdirs.PrimDir.CONTRAANTMC:
			return mtexts.txts['MC']
		offs = primdirs.PrimDir.ANTISCION
		if pd.prom >= primdirs.PrimDir.CONTRAANT:
			offs = primdirs.PrimDir.CONTRAANT
		obj = pd.prom - offs
		if 0 <= obj < len(common.common.Planets):
			return common.common.Planets[obj]
		return ''
	if pd.prom >= primdirs.PrimDir.TERM and pd.prom < primdirs.PrimDir.FIXSTAR:
		signs = common.common.Signs1
		if 0 <= (pd.prom-primdirs.PrimDir.TERM) < len(signs):
			return signs[pd.prom-primdirs.PrimDir.TERM]
		return ''
	if pd.prom >= primdirs.PrimDir.FIXSTAR:
		return ''
	if pd.prom == primdirs.PrimDir.LOF:
		return common.common.fortune
	if pd.prom == primdirs.PrimDir.CUSTOMERPD:
		return mtexts.txts['Customer2']
	if pd.prom == primdirs.PrimDir.ASC:
		return mtexts.txts['Asc']
	if pd.prom == primdirs.PrimDir.MC:
		return mtexts.txts['MC']
	if pd.prom >= primdirs.PrimDir.HC2 and pd.prom < primdirs.PrimDir.LOF:
		HCs = (mtexts.txts['HC2'], mtexts.txts['HC3'], mtexts.txts['HC5'], mtexts.txts['HC6'], mtexts.txts['HC8'], mtexts.txts['HC9'], mtexts.txts['HC11'], mtexts.txts['HC12'])
		idx = pd.sig-primdirs.PrimDir.HC2
		if 0 <= idx < len(HCs):
			return HCs[idx]
		return ''
	if 0 <= pd.prom < len(common.common.Planets):
		return common.common.Planets[pd.prom]
	return ''


def _pd_sig_glyph_table(pd):
	if pd.sigasp == chart.Chart.PARALLEL or pd.sigasp == chart.Chart.CONTRAPARALLEL:
		if 0 <= pd.sig < len(common.common.Planets):
			return common.common.Planets[pd.sig]
		return ''
	if pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
		angles = ('('+mtexts.txts['Asc']+')', '('+mtexts.txts['Dsc']+')', '('+mtexts.txts['MC']+')', '('+mtexts.txts['IC']+')')
		idx = pd.parallelaxis-primdirs.PrimDir.OFFSANGLES
		if 0 <= idx < len(angles):
			return angles[idx]
		return ''
	if pd.sig == primdirs.PrimDir.LOF:
		return common.common.fortune
	if pd.sig == primdirs.PrimDir.SYZ:
		return mtexts.txts['Syzygy']
	if pd.sig == primdirs.PrimDir.CUSTOMERPD:
		return mtexts.txts['User2']
	if pd.sig >= primdirs.PrimDir.OFFSANGLES and pd.sig < primdirs.PrimDir.LOF:
		if pd.sig <= primdirs.PrimDir.IC:
			angles = (mtexts.txts['Asc'], mtexts.txts['Dsc'], mtexts.txts['MC'], mtexts.txts['IC'])
			idx = pd.sig-primdirs.PrimDir.OFFSANGLES
			if 0 <= idx < len(angles):
				return angles[idx]
			return ''
		HCs = (mtexts.txts['HC2'], mtexts.txts['HC3'], mtexts.txts['HC5'], mtexts.txts['HC6'], mtexts.txts['HC8'], mtexts.txts['HC9'], mtexts.txts['HC11'], mtexts.txts['HC12'])
		idx = pd.sig-primdirs.PrimDir.HC2
		if 0 <= idx < len(HCs):
			return HCs[idx]
		return ''
	if 0 <= pd.sig < len(common.common.Planets):
		return common.common.Planets[pd.sig]
	return ''


class _WorkspacePDStepperAdapter(object):
	def __init__(self, chart_session, radix_chart, options,
				 pds=None, initial_arc=0.0, initial_direct=True, initial_pds_idx=None,
				 ingress=False):
		self._chart_session = chart_session
		self._radix_chart = radix_chart
		self._options = options
		self._ingress = ingress
		# celestial keyboard navigation state
		self._pds = []                 # list of PD entries sorted by event time
		self._arc = float(initial_arc) # current absolute arc in degrees
		self._direct = False
		self._pds_idx = None
		# time stepping (left/right) is always available for celestial PD-in-chart tabs
		self._time_step_enabled = (not ingress)
		self.set_pds_entries(pds or [], initial_pds_idx)

	def change(self, chrt, y, m, d, ho, mi, se, pdtypetxt, pdkeytxt, txtdir, da):
		if self._ingress:
			tim = chart.Time(y, m, d, ho, mi, se, self._radix_chart.time.bc, chart.Time.GREGORIAN, chart.Time.GREENWICH, True, 0, 0, False, self._radix_chart.place, False)
			chrt = chart.Chart(self._radix_chart.name, self._radix_chart.male, tim, self._radix_chart.place, chart.Chart.PDINCHART, '', self._options, False)
		# keep keyboard-nav state in sync with dialog-driven changes
		self._arc = math.fabs(float(da))
		self._direct = False
		try:
			chrt._pd_arc_signed = -math.fabs(float(da))
			chrt._pd_arc_abs = math.fabs(float(da))
			chrt._pd_direct = False
		except Exception:
			pass
		self._pds_idx = self._nearest_pds_idx(self._arc, self._direct)
		self._chart_session.change_chart(chrt)

	def set_pds_entries(self, pds_entries, preferred_idx=None):
		if pds_entries is None:
			pds_entries = []
		source_entries = list(pds_entries)
		# navigation order follows the symbolic arc from birth, always positive
		self._pds = sorted(source_entries, key=lambda pd: (math.fabs(pd.arc), pd.time))
		if not self._pds:
			self._pds_idx = None
			return

		if preferred_idx is not None and 0 <= preferred_idx < len(source_entries):
			selected_pd = source_entries[preferred_idx]
			mapped_idx = None
			for i, pd in enumerate(self._pds):
				if pd is selected_pd:
					mapped_idx = i
					break
			if mapped_idx is not None:
				self._pds_idx = mapped_idx
				pd = self._pds[self._pds_idx]
				self._arc = math.fabs(pd.arc)
				self._direct = False
				return

		self._pds_idx = self._nearest_pds_idx(self._arc, self._direct)

	def _arc_delta_per_year(self):
		"""Arc degrees representing 1 real year under the active PD key."""
		opts = self._options
		if opts.pdkeydyn:
			# True/Birthday solar arc ≈ Naibod (mean solar arc) per year - good for stepping
			coeff = primdirs.PrimDirs.staticData[primdirs.PrimDirs.NAIBOD][primdirs.PrimDirs.COEFF]
			return 1.0 / coeff if coeff > 0.0 else 1.0
		if opts.pdkeys == primdirs.PrimDirs.CUSTOMER:
			val = opts.pdkeydeg + opts.pdkeymin / 60.0 + opts.pdkeysec / 3600.0
			return val if val > 0.0 else 1.0
		coeff = primdirs.PrimDirs.staticData[opts.pdkeys][primdirs.PrimDirs.COEFF]
		return 1.0 / coeff if coeff > 0.0 else 1.0

	def _nearest_pds_idx(self, arc, direct):
		if not self._pds:
			return None
		best = 0
		best_key = None
		current_bias = self._pds_idx if self._pds_idx is not None else 0
		for i, pd in enumerate(self._pds):
			key = (abs(math.fabs(pd.arc) - arc), abs(i - current_bias))
			if best_key is None or key < best_key:
				best_key = key
				best = i
		return best

	def handle_navigation_key(self, keycode, shift_down=False, alt_down=False,
							  control_down=False, cmd_down=False):
		if keycode in (wx.WXK_LEFT, wx.WXK_RIGHT):
			if not self._time_step_enabled:
				return False
			# Time-step by arc: right=future(+arc), left=past(-arc)
			# modifiers: plain=year, shift=month, alt=week
			arc_per_year = self._arc_delta_per_year()
			if alt_down:
				delta_years = 1.0 / 52.0
			elif shift_down:
				delta_years = 1.0 / 12.0
			else:
				delta_years = 1.0
			delta_arc = arc_per_year * delta_years
			if keycode == wx.WXK_LEFT:
				delta_arc = -delta_arc
			new_arc = max(0.0, self._arc + delta_arc)
			da = -new_arc
			try:
				pdchart = _compute_celestial_pd_chart(self._radix_chart, da, self._options)
				_attach_pd_exact_event(pdchart, None)
				self._arc = new_arc
				self._pds_idx = self._nearest_pds_idx(new_arc, self._direct)
				self._chart_session.change_chart(pdchart)
			except Exception:
				pass
			return True
		if keycode in (wx.WXK_UP, wx.WXK_DOWN):
			# Jump by exact PD events in strict list order
			if not self._pds:
				return False
			if self._pds_idx is None:
				self._pds_idx = self._nearest_pds_idx(self._arc, self._direct)
				if self._pds_idx is None:
					return False
			new_idx = self._pds_idx + (1 if keycode == wx.WXK_UP else -1)
			if new_idx < 0 or new_idx >= len(self._pds):
				return True  # at the limit — swallow the key
			pd = self._pds[new_idx]
			da = -math.fabs(pd.arc)
			try:
				pdchart = _compute_celestial_pd_chart(self._radix_chart, da, self._options)
				_attach_pd_exact_event(pdchart, pd)
				self._pds_idx = new_idx
				self._arc = math.fabs(pd.arc)
				self._direct = False
				self._chart_session.change_chart(pdchart)
			except Exception:
				pass
			return True
		return False


class PrimDirsListWnd(wx.ScrolledWindow):
	SCROLL_RATE = 20
	BORDER = 20

	def __init__(self, parent, chrt, options, pds, mainfr, currpage, maxpage, fr, to, id = -1, size = wx.DefaultSize):
		wx.ScrolledWindow.__init__(self, parent, id, (0, 0), size=size, style=wx.SUNKEN_BORDER)

		self.parent = parent
		self.chart = chrt
		self.options = options
		self.bw = self.options.bw
		self.pds = pds
		self.mainfr = mainfr

		self.SetBackgroundColour(self.options.clrbackground)
		self.SetScrollRate(PrimDirsListWnd.SCROLL_RATE, PrimDirsListWnd.SCROLL_RATE)

		self.pmenu = wx.Menu()
		self.ID_SaveAsBitmap = wx.NewId()
		self.ID_SaveAsText = wx.NewId()
		self.ID_BlackAndWhite = wx.NewId()
		if chrt.htype == chart.Chart.RADIX:
			self.ID_PDsInChartInZod = wx.NewId()
			self.ID_PDsInChartInMun = wx.NewId()
			self.ID_PDsInChartIngress = wx.NewId()

		#self.pmenu.Append(self.ID_SaveAsBitmap, mtexts.txts['SaveAsBmp'], mtexts.txts['SaveTable'])
		#self.pmenu.Append(self.ID_SaveAsText, mtexts.txts['SaveAsText'], mtexts.txts['SavePDs'])
		#mbw = self.pmenu.Append(self.ID_BlackAndWhite, mtexts.txts['BlackAndWhite'], mtexts.txts['TableBW'], wx.ITEM_CHECK)
		#if chrt.htype == chart.Chart.RADIX:
			#self.pmenu.Append(self.ID_PDsInChartInZod, mtexts.txts['PDsInChartInZod'], mtexts.txts['PDsInChartInZod'])
			#self.pmenu.Append(self.ID_PDsInChartInMun, mtexts.txts['PDsInChartInMun'], mtexts.txts['PDsInChartInMun'])
			#self.pmenu.Append(self.ID_PDsInChartIngress, mtexts.txts['PDsInChartIngress'], mtexts.txts['PDsInChartIngress'])
		# --- PDs in Chart 하위 메뉴를 먼저 만들고 상단에 배치 ---
		if chrt.htype == chart.Chart.RADIX:
			self.pdsmenu = wx.Menu()
			self.pdsmenu.Append(self.ID_PDsInChartInZod, mtexts.txts['PDsInChartInZod'], mtexts.txts['PDsInChartInZod'])
			self.pdsmenu.Append(self.ID_PDsInChartInMun, mtexts.txts['PDsInChartInMun'], mtexts.txts['PDsInChartInMun'])
			self.pdsmenu.Append(self.ID_PDsInChartIngress, mtexts.txts['PDsInChartIngress'], mtexts.txts['PDsInChartIngress'])

			# wx 4.x (Phoenix): AppendSubMenu, 구버전 호환: AppendMenu
			if hasattr(self.pmenu, "AppendSubMenu"):
				self.pmenu.AppendSubMenu(self.pdsmenu, mtexts.txts['PDsInChart'])
			else:
				self.pmenu.AppendMenu(wx.ID_ANY, mtexts.txts['PDsInChart'], self.pdsmenu)

		# --- Save 하위 메뉴 묶음 ---
		self.savemenu = wx.Menu()
		self.savemenu.Append(self.ID_SaveAsBitmap, mtexts.txts['SaveAsBmp'], mtexts.txts['SaveTable'])
		self.savemenu.Append(self.ID_SaveAsText,  mtexts.txts['SaveAsText'], mtexts.txts['SavePDs'])
		label_save = mtexts.txts['Save'] if 'Save' in mtexts.txts else u'Save'

		if hasattr(self.pmenu, "AppendSubMenu"):
			self.pmenu.AppendSubMenu(self.savemenu, label_save)
		else:
			self.pmenu.AppendMenu(wx.ID_ANY, label_save, self.savemenu)

		mbw = self.pmenu.Append(self.ID_BlackAndWhite, mtexts.txts['BlackAndWhite'], mtexts.txts['TableBW'], wx.ITEM_CHECK)

		self.Bind(wx.EVT_PAINT, self.OnPaint)
		self.Bind(wx.EVT_RIGHT_UP, self.onPopupMenu)
		self.Bind(wx.EVT_CONTEXT_MENU, self.onPopupMenu)
		self.Bind(wx.EVT_LEFT_UP, self.onLeftUp)
		self.Bind(wx.EVT_MENU, self.onSaveAsBitmap, id=self.ID_SaveAsBitmap)
		self.Bind(wx.EVT_MENU, self.onSaveAsText, id=self.ID_SaveAsText)
		self.Bind(wx.EVT_MENU, self.onBlackAndWhite, id=self.ID_BlackAndWhite)
		if chrt.htype == chart.Chart.RADIX:
			self.Bind(wx.EVT_MENU, self.onPDsInChartZod, id=self.ID_PDsInChartInZod)
			self.Bind(wx.EVT_MENU, self.onPDsInChartMun, id=self.ID_PDsInChartInMun)
			self.Bind(wx.EVT_MENU, self.onPDsInChartIngress, id=self.ID_PDsInChartIngress)

		if (self.bw):
			mbw.Check()

		self.FONT_SIZE = int(21*self.options.tablesize) #Change fontsize to change the size of the table!
		self.SPACE = (self.FONT_SIZE/2)
		self.LINE_HEIGHT = (self.SPACE+self.FONT_SIZE+self.SPACE)
		self.LINE_NUM = getattr(parent, 'LINE_NUM', 40) #Per column
		self.COLUMN_NUM = 6

		self.currpage = currpage
		self.maxpage = maxpage
		self.fr = fr
		self.to = to

		self.SMALL_CELL_WIDTH = (4*self.FONT_SIZE)
		self.CELL_WIDTH = (6*self.FONT_SIZE)
		self.BIG_CELL_WIDTH = (8*self.FONT_SIZE)
		self.TABLE_WIDTH = (2*self.SMALL_CELL_WIDTH+3*self.CELL_WIDTH+self.BIG_CELL_WIDTH)
		self.SPACE_TITLEY = 4
		self.TITLE_CELL_HEIGHT = (2*self.LINE_HEIGHT)
		self.TABLE_HEIGHT = ((self.TITLE_CELL_HEIGHT)+(self.SPACE_TITLEY)+(self.LINE_NUM)*(self.LINE_HEIGHT))
		self.SPACE_BETWEEN_TABLESX = 4
		self.TITLE_CELL_WIDTH = (2*self.TABLE_WIDTH+self.SPACE_BETWEEN_TABLESX+1)
		self.SECOND_TABLE_OFFSX = (self.TABLE_WIDTH+self.SPACE_BETWEEN_TABLESX)
	
		self.WIDTH = int(PrimDirsListWnd.BORDER+self.TITLE_CELL_WIDTH+PrimDirsListWnd.BORDER)
		self.HEIGHT = int(PrimDirsListWnd.BORDER+self.TABLE_HEIGHT+PrimDirsListWnd.BORDER)

		self.SetVirtualSize((self.WIDTH, self.HEIGHT))

		self.fntMorinus = ImageFont.truetype(common.common.symbols, int(self.FONT_SIZE))
		self.fntSymbol = ImageFont.truetype(common.common.symbols, int(3*self.FONT_SIZE/2))
		self.fntAspects = ImageFont.truetype(common.common.symbols, int(3*self.FONT_SIZE/4))
		self.fntText = ImageFont.truetype(common.common.abc, int(self.FONT_SIZE))
		self.clrs = (self.options.clrdomicil, self.options.clrexal, self.options.clrperegrin, self.options.clrcasus, self.options.clrexil)

		self.drawBkg()
		self.curposx = None
		self.curposy = None
		self._last_pdnum = len(self.pds.pds)-1 if len(self.pds.pds) > 0 else None


	def onPopupMenu(self, event):
		pos = event.GetPosition()
		try:
			if hasattr(event, "GetEventType") and event.GetEventType() == wx.EVT_CONTEXT_MENU.typeId:
				pos = self.ScreenToClient(pos)
		except Exception:
			pass
		self.curposx, self.curposy = pos
		valid, pdnum = self.getPDNum(event)
		if valid:
			self._last_pdnum = pdnum
		windowbehavior.popup_menu(self, self.pmenu, event)

	def onLeftUp(self, event):
		if event is not None:
			self.curposx, self.curposy = event.GetPosition()
			valid, pdnum = self.getPDNum(event)
			if valid:
				self._last_pdnum = pdnum
		event.Skip()

	def _use_workspace_tabs(self):
		if self.mainfr is None:
			return False
		if not hasattr(self.mainfr, '_open_workspace_session'):
			return False
		if not hasattr(self.mainfr, '_workspace_shell') or self.mainfr._workspace_shell is None:
			return False
		try:
			host = self.mainfr._workspace_shell.get_table_host()
			return self.parent is host
		except Exception:
			return False

	def _open_workspace_pd_tab(self, txt, display_chart, y, m, d, t, direct, da, terrestrial, ingress=False, pds_idx=None):
		if not self._use_workspace_tabs():
			return False
		workspace_chart = display_chart
		if not terrestrial and not ingress:
			workspace_chart = _compute_celestial_pd_chart(self.chart, -math.fabs(float(da)), self.options)
			if pds_idx is not None and 0 <= pds_idx < len(self.pds.pds):
				_attach_pd_exact_event(workspace_chart, self.pds.pds[pds_idx])
			else:
				_attach_pd_exact_event(workspace_chart, None)
		doc = self.mainfr._open_workspace_session(
			workspace_chart,
			session_label=txt,
			radix=self.chart,
			view_mode=chart_session.ChartSession.COMPOUND,
		)
		if doc is None:
			return True
		cs = self.mainfr._active_chart_session()
		if cs is None:
			return True
		# Wire keyboard navigation for celestial (non-terrestrial, non-ingress) PDs
		pds_list = self.pds.pds if (not terrestrial and not ingress) else None
		adapter = _WorkspacePDStepperAdapter(
			cs, self.chart, self.options,
			pds=pds_list,
			initial_arc=math.fabs(float(da)),
			initial_direct=False,
			initial_pds_idx=pds_idx,
			ingress=ingress,
		)
		if not terrestrial and not ingress:
			self._ensure_workspace_full_pd_list(adapter)
		cs._stepper = adapter
		return True

	def _detect_pd_direction_mode(self):
		entries = getattr(self.pds, 'pds', [])
		if not entries:
			return primdirs.PrimDirs.BOTHDC
		has_direct = False
		has_converse = False
		for pd in entries:
			if pd.direct:
				has_direct = True
			else:
				has_converse = True
			if has_direct and has_converse:
				return primdirs.PrimDirs.BOTHDC
		if has_direct:
			return primdirs.PrimDirs.DIRECT
		if has_converse:
			return primdirs.PrimDirs.CONVERSE
		return primdirs.PrimDirs.BOTHDC

	def _ensure_workspace_full_pd_list(self, adapter):
		"""Build full 150-year PD list in background and swap it into the adapter when ready."""
		def worker():
			try:
				import placidiansapd
				import placidianutppd
				import regiomontanpd
				import campanianpd

				direction = self._detect_pd_direction_mode()
				abort = primdirs.AbortPD()
				if self.options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC:
					full = placidiansapd.PlacidianSAPD(self.chart, self.options, primdirs.PrimDirs.RANGEALL, direction, abort)
				elif self.options.primarydir == primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE:
					full = placidianutppd.PlacidianUTPPD(self.chart, self.options, primdirs.PrimDirs.RANGEALL, direction, abort)
				elif self.options.primarydir == primdirs.PrimDirs.REGIOMONTAN:
					full = regiomontanpd.RegiomontanPD(self.chart, self.options, primdirs.PrimDirs.RANGEALL, direction, abort)
				else:
					full = campanianpd.CampanianPD(self.chart, self.options, primdirs.PrimDirs.RANGEALL, direction, abort)
				wx.CallAfter(adapter.set_pds_entries, getattr(full, 'pds', []), None)
			except Exception:
				pass

		thread = threading.Thread(target=worker)
		thread.daemon = True
		thread.start()

	def _pd_index(self, pdnum, total):
		"""pdnum을 0-based 인덱스로 정규화. 실패 시 None.
		- 이 테이블 클릭(getPDNum 경로)에서 들어오는 int는 0-based로 취급
		- 그 외(str/float 등)는 표시용 번호일 수 있어 1-based로 우선 취급(단, 0은 0-based)
		"""
		pdnum_orig = pdnum
		try:
			# bytes → str
			if isinstance(pdnum, bytes):
				pdnum = pdnum.decode('utf-8', 'ignore')

			# str일 수 있음: "12", "12.0", "No. 12", "12."
			if isinstance(pdnum, str):
				m = re.search(r'\d+', pdnum)
				if not m:
					return None
				val = int(m.group(0))
			elif isinstance(pdnum, float):
				val = int(round(pdnum))
			else:
				val = int(pdnum)
		except Exception:
			return None

		if total <= 0:
			return None

		# int 입력(테이블 클릭)은 0-based가 기본
		if isinstance(pdnum_orig, int) and not isinstance(pdnum_orig, bool):
			if 0 <= val < total:
				return val
			# 혹시 1-based가 들어오는 예외 케이스만 보정
			if 1 <= val <= total:
				return val - 1
			return None

		# 그 외(str/float)는 1-based로 우선 해석(단, 0은 0-based)
		if val == 0:
			return 0
		if 1 <= val <= total:
			return val - 1
		if 0 <= val < total:
			return val
		return None


	def onSaveAsBitmap(self, event):
		name = self.chart.name+mtexts.txts['PD']
		dlg = wx.FileDialog(self, mtexts.txts['SaveAsBmp'], '', name, mtexts.txts['BMPFiles'], wx.FD_SAVE)
		if os.path.isdir(self.mainfr.fpathimgs):
			dlg.SetDirectory(self.mainfr.fpathimgs)
		else:
			dlg.SetDirectory(u'.')

		if (dlg.ShowModal() == wx.ID_OK):
			dpath = dlg.GetDirectory()
			fpath = dlg.GetPath()
			if (not fpath.endswith(u'.bmp')):
				fpath+=u'.bmp'
			#Check if fpath already exists!?
			if (os.path.isfile(fpath)):
				dlgm = wx.MessageDialog(self, mtexts.txts['FileExists'], mtexts.txts['Message'], wx.YES_NO|wx.YES_DEFAULT|wx.ICON_QUESTION)
				if (dlgm.ShowModal() == wx.ID_NO):
					dlgm.Destroy()
					dlg.Destroy()
					return
				dlgm.Destroy()

			self.mainfr.fpathimgs = dpath
			self.buffer.SaveFile(fpath, wx.BITMAP_TYPE_BMP)

		dlg.Destroy()


	def onSaveAsText(self, event):
		if self.options.langid != 0:
			dlg = wx.MessageDialog(self, mtexts.txts['SwitchToEnglish'], mtexts.txts['Message'], wx.OK)
			dlg.ShowModal()
			return		

		name = self.chart.name+mtexts.txts['PD']
		dlg = wx.FileDialog(self, mtexts.txts['SaveAsText'], '', name, mtexts.txts['TXTFiles'], wx.FD_SAVE)
		if os.path.isdir(self.mainfr.fpathimgs):
			dlg.SetDirectory(self.mainfr.fpathimgs)
		else:
			dlg.SetDirectory(u'.')

		if dlg.ShowModal() == wx.ID_OK:
			dpath = dlg.GetDirectory()
			fpath = dlg.GetPath()
			if not fpath.endswith(u'.txt'):
				fpath+=u'.txt'
			#Check if fpath already exists!?
			if os.path.isfile(fpath):
				dlg = wx.MessageDialog(self, mtexts.txts['FileExists'], mtexts.txts['Message'], wx.YES_NO|wx.YES_DEFAULT|wx.ICON_QUESTION)
				if dlg.ShowModal() == wx.ID_NO:
					return

			self.mainfr.fpathimgs = dpath
			self.pds.print2file(fpath)		


	def onBlackAndWhite(self, event):
		if (self.bw != event.IsChecked()):
			self.bw = event.IsChecked()
			self.drawBkg()
			self.Refresh()


	def onPDsInChartZod(self, event):
		valid, pdnum = self.getPDNum(event)
		if not valid:
			dlg = wx.MessageDialog(self, mtexts.txts['PDClickError'], mtexts.txts['Message'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return

		idx = self._pd_index(pdnum, len(self.pds.pds))
		if idx is None:
			return  
		#if self.pds.pds[idx].mundane:

			#dlg = wx.MessageDialog(self, mtexts.txts['NotAvailableWithPDSettings'], mtexts.txts['Message'], wx.OK|wx.ICON_EXCLAMATION)
			#dlg.ShowModal()
			#return

		valid, y, m, d, ho, mi, se, t, pdtypetxt, pdkeytxt, direct, da, pdchart = self.calc(event, False, idx)
		if not valid:
			dlg = wx.MessageDialog(self, mtexts.txts['PDClickError'], mtexts.txts['Message'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return

		txtdir = mtexts.txts['D']
		if not direct:
			txtdir = mtexts.txts['C']

		txt = pdtypetxt+' '+pdkeytxt+' '+txtdir+' '+str(y)+'.'+str(m).zfill(2)+'.'+str(d).zfill(2)+' '+str(ho).zfill(2)+':'+str(mi).zfill(2)+':'+str(se).zfill(2)+'  '+str(da)
		if self._open_workspace_pd_tab(txt, pdchart, y, m, d, t, direct, da, False, pds_idx=idx):
			return
		rw = pdsinchartframe.PDsInChartFrame(self.mainfr, txt, pdchart, self.chart, self.options)
		rw.Show(True)

		pdstepdlg = pdsinchartstepperdlg.PDsInChartStepperDlg(rw, self.chart, y, m, d, t, direct, da, self.options, False)
		pdstepdlg.CenterOnParent()
		pdstepdlg.Show(True)


	def onPDsInChartMun(self, event):
		valid, pdnum = self.getPDNum(event)
		if not valid:
			dlg = wx.MessageDialog(self, mtexts.txts['PDClickError'], mtexts.txts['Message'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return

		idx = self._pd_index(pdnum, len(self.pds.pds))
		if idx is None:
			return
		#if not self.pds.pds[idx].mundane:
			# ... 이후 pdnum 대신 idx 사용 ...
		# and "From the planets" in Options (Disable the Terrestrial-menuitem instead)
			#dlg = wx.MessageDialog(self, mtexts.txts['NotAvailableWithPDSettings'], mtexts.txts['Message'], wx.OK|wx.ICON_EXCLAMATION)
			#dlg.ShowModal()
			#return

		valid, y, m, d, ho, mi, se, t, pdtypetxt, pdkeytxt, direct, da, pdchart = self.calc(event, True, idx)

		if not valid:
			dlg = wx.MessageDialog(self, mtexts.txts['PDClickError'], mtexts.txts['Message'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return

		txtdir = mtexts.txts['D']
		if not direct:
			txtdir = mtexts.txts['C']

		txt = pdtypetxt+' '+pdkeytxt+' '+txtdir+' '+str(y)+'.'+str(m).zfill(2)+'.'+str(d).zfill(2)+' '+str(ho).zfill(2)+':'+str(mi).zfill(2)+':'+str(se).zfill(2)+'  '+str(da)
		if self._open_workspace_pd_tab(txt, pdchart, y, m, d, t, direct, da, True):
			return
		rw = pdsinchartframe.PDsInChartFrame(self.mainfr, txt, pdchart, self.chart, self.options, 0, False)
		rw.Show(True)

		pdstepdlg = pdsinchartstepperdlg.PDsInChartStepperDlg(rw, self.chart, y, m, d, t, direct, da, self.options, True)
		pdstepdlg.CenterOnParent()
		pdstepdlg.Show(True)


	def onPDsInChartIngress(self, event):
		valid, pdnum = self.getPDNum(event)
		if not valid:
			dlg = wx.MessageDialog(self, mtexts.txts['PDClickError'], mtexts.txts['Message'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return

		idx = self._pd_index(pdnum, len(self.pds.pds))
		if idx is None:
			return

		#if self.pds.pds[idx].mundane:
			#dlg = wx.MessageDialog(self, mtexts.txts['NotAvailableWithPDSettings'], mtexts.txts['Message'], wx.OK|wx.ICON_EXCLAMATION)
			#dlg.ShowModal()
			#return

		valid, y, m, d, ho, mi, se, t, pdtypetxt, pdkeytxt, direct, da, pdchart = self.calc(event, False, idx)

		if not valid:
			dlg = wx.MessageDialog(self, mtexts.txts['PDClickError'], mtexts.txts['Message'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return

		#create Ingress-chart
		cal = chart.Time.GREGORIAN
		if self.chart.time.cal == chart.Time.JULIAN:
			cal = chart.Time.JULIAN
		tim = chart.Time(y, m, d, ho, mi, se, self.chart.time.bc, cal, chart.Time.GREENWICH, True, 0, 0, False, self.chart.place, False)
		ingchart = chart.Chart(self.chart.name, self.chart.male, tim, self.chart.place, chart.Chart.PDINCHART, '', self.options, False)

		txtdir = mtexts.txts['D']
		if not direct:
			txtdir = mtexts.txts['C']

		txt = pdtypetxt+' '+pdkeytxt+' '+txtdir+' '+str(y)+'.'+str(m).zfill(2)+'.'+str(d).zfill(2)+' '+str(ho).zfill(2)+':'+str(mi).zfill(2)+':'+str(se).zfill(2)+'  '+str(da)
		if self._open_workspace_pd_tab(txt, ingchart, y, m, d, t, direct, da, False, ingress=True):
			return
		rw = pdsinchartingressframe.PDsInChartIngressFrame(self.mainfr, txt, self.chart, pdchart, ingchart, self.options)
		rw.Show(True)

		pdstepdlg = pdsinchartstepperdlg.PDsInChartStepperDlg(rw, self.chart, y, m, d, t, direct, da, self.options, False)
		pdstepdlg.CenterOnParent()
		pdstepdlg.Show(True)

	def calc(self, event, terrestrial, force_idx=None):
		total = len(self.pds.pds)
		if total <= 0:
			return False, 2000, 1, 1, 1, 1, 1, 1.0, '', '', True, 0.0, None

		if force_idx is not None:
			try:
				idx = int(force_idx)
			except Exception:
				idx = total - 1
			# ← 범위 보정(클램프)
			if idx < 0:
				idx = 0
			elif idx >= total:
				idx = total - 1
		else:
			valid, pdnum = self.getPDNum(event)
			if not valid:
				return False, 2000, 1, 1, 1, 1, 1, 1.0, '', '', True, 0.0, None
			idx = self._pd_index(pdnum, total)
			if idx is None:
				return False, 2000, 1, 1, 1, 1, 1, 1.0, '', '', True, 0.0, None

		y, m, d, t = astrology.swe_revjul(self.pds.pds[idx].time, 1)
		ho, mi, se = util.decToDeg(t)

		da = self.pds.pds[idx].arc
		if not self.pds.pds[idx].direct:
			da *= -1

		pdinch = pdsinchart.PDsInChart(self.chart, da) #self.yz, mz, dz, tz ==> chart
		pdh, pdm, pds = util.decToDeg(pdinch.tz)
		cal = chart.Time.GREGORIAN
		if self.chart.time.cal == chart.Time.JULIAN:
			cal = chart.Time.JULIAN
		tim = chart.Time(pdinch.yz, pdinch.mz, pdinch.dz, pdh, pdm, pds, self.chart.time.bc, cal, chart.Time.GREENWICH, True, 0, 0, False, self.chart.place, False)
		if not terrestrial:
			if self.options.pdincharttyp == pdsinchartdlgopts.PDsInChartsDlgOpts.FROMMUNDANEPOS:
				pdchart = chart.Chart(self.chart.name, self.chart.male, tim, self.chart.place, chart.Chart.PDINCHART, '', self.options, False)#, proftype, nolat)
				pdchartpls = chart.Chart(self.chart.name, self.chart.male, self.chart.time, self.chart.place, chart.Chart.PDINCHART, '', self.options, False)
				#modify planets ...
				if self.options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC or self.options.primarydir == primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE:
					pdchart.planets.calcMundaneProfPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, self.chart.place.lat, self.chart.obl[0])
				else:
					pdchart.houses = houses.Houses(tim.jd, 0, pdchart.place.lat, pdchart.place.lon, 'R', pdchart.obl[0], self.options.ayanamsha, pdchart.ayanamsha)
					pdchart.planets.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, self.chart.place.lat, self.chart.obl[0])

				#modify lof
				if self.options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC or self.options.primarydir == primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE:
					pdchart.fortune.calcMundaneProfPos(pdchart.houses.ascmc2, pdchartpls.fortune, self.chart.place.lat, self.chart.obl[0])
				else:
					pdchart.fortune.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.fortune, self.chart.place.lat, self.chart.obl[0])

			elif self.options.pdincharttyp == pdsinchartdlgopts.PDsInChartsDlgOpts.FROMZODIACALPOS:
				pdchart = chart.Chart(self.chart.name, self.chart.male, tim, self.chart.place, chart.Chart.PDINCHART, '', self.options, False, chart.Chart.YEAR, True)

				pdchartpls = chart.Chart(self.chart.name, self.chart.male, self.chart.time, self.chart.place, chart.Chart.PDINCHART, '', self.options, False, chart.Chart.YEAR, True)
				#modify planets ...
				if self.options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC or self.options.primarydir == primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE:
					pdchart.planets.calcMundaneProfPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, self.chart.place.lat, self.chart.obl[0])
				else:
					pdchart.houses = houses.Houses(tim.jd, 0, pdchart.place.lat, pdchart.place.lon, 'R', pdchart.obl[0], self.options.ayanamsha, pdchart.ayanamsha)
					pdchart.planets.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, self.chart.place.lat, self.chart.obl[0])

				#modify lof
				if self.options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC or self.options.primarydir == primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE:
					pdchart.fortune.calcMundaneProfPos(pdchart.houses.ascmc2, pdchartpls.fortune, self.chart.place.lat, self.chart.obl[0])
				else:
					pdchart.fortune.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.fortune, self.chart.place.lat, self.chart.obl[0])

			else:#Full Astronomical Procedure
				pdchart = chart.Chart(self.chart.name, self.chart.male, tim, self.chart.place, chart.Chart.PDINCHART, '', self.options, False)#, proftype, nolat)

				pdchartpls = chart.Chart(self.chart.name, self.chart.male, self.chart.time, self.chart.place, chart.Chart.PDINCHART, '', self.options, False)

				pdpls = pdchartpls.planets.planets
				if self.options.pdinchartsecmotion:
					pdpls = pdchart.planets.planets

				raequasc, declequasc, dist = astrology.swe_cotrans(pdchart.houses.ascmc[houses.Houses.EQUASC], 0.0, 1.0, -self.chart.obl[0])
				pdchart.planets.calcFullAstronomicalProc(da, self.chart.obl[0], pdpls, pdchart.place.lat, pdchart.houses.ascmc2, raequasc) #planets
				pdchart.fortune.calcFullAstronomicalProc(pdchartpls.fortune, da, self.chart.obl[0]) 

		else:
			if self.options.pdinchartterrsecmotion:
				pdchart = chart.Chart(self.chart.name, self.chart.male, tim, self.chart.place, chart.Chart.PDINCHART, '', self.options, False)#, proftype, nolat)
			else:
				pdchart = chart.Chart(self.chart.name, self.chart.male, self.chart.time, self.chart.place, chart.Chart.PDINCHART, '', self.options, False)#, proftype, nolat)
				raequasc, declequasc, dist = astrology.swe_cotrans(pdchart.houses.ascmc[houses.Houses.EQUASC], 0.0, 1.0, -self.chart.obl[0])
				pdchart.planets.calcMundaneWithoutSM(da, self.chart.obl[0], pdchart.place.lat, pdchart.houses.ascmc2, raequasc)

			pdchart.fortune.recalcForMundaneChart(self.chart.fortune.fortune[fortune.Fortune.LON], self.chart.fortune.fortune[fortune.Fortune.LAT], self.chart.fortune.fortune[fortune.Fortune.RA], self.chart.fortune.fortune[fortune.Fortune.DECL], pdchart.houses.ascmc2, pdchart.raequasc, pdchart.obl[0], pdchart.place.lat)


		keytxt = mtexts.typeListDyn[self.options.pdkeyd]
		if not self.options.pdkeydyn:
			keytxt = mtexts.typeListStat[self.options.pdkeys]

		try:
			pdchart._pd_arc_signed = float(da)
			pdchart._pd_arc_abs = math.fabs(float(da))
			pdchart._pd_direct = bool(self.pds.pds[idx].direct)
			_attach_pd_exact_event(pdchart, self.pds.pds[idx])
		except Exception:
			pass

		return True, y, m, d, ho, mi, se, t, mtexts.typeListDirs[self.options.primarydir], keytxt, self.pds.pds[idx].direct, math.fabs(da), pdchart

		#else:
			#return False, 2000, 1, 1, 1, 1, 1, 1.0, '', '', True, 0.0, None


	def getPDNum(self, event):
		if self.curposx is None or self.curposy is None:
			if self._last_pdnum is not None and 0 <= self._last_pdnum < len(self.pds.pds):
				return True, self._last_pdnum
			return False, None

		xu, yu = self.GetScrollPixelsPerUnit()
		xs, ys = self.GetViewStart()
		yscrolledoffs = yu*ys
		xscrolledoffs = xu*xs
		x,y = self.curposx, self.curposy
		offs = PrimDirsListWnd.BORDER+self.TITLE_CELL_HEIGHT+self.SPACE_TITLEY

		self.SECOND_TABLE_OFFSX = (self.TABLE_WIDTH+self.SPACE_BETWEEN_TABLESX)
		if (y+yscrolledoffs > offs and y+yscrolledoffs < offs+self.TABLE_HEIGHT) and ((x+xscrolledoffs > PrimDirsListWnd.BORDER and x+xscrolledoffs < PrimDirsListWnd.BORDER+self.TABLE_WIDTH) or (x+xscrolledoffs > PrimDirsListWnd.BORDER+self.SECOND_TABLE_OFFSX and x+xscrolledoffs < PrimDirsListWnd.BORDER+self.SECOND_TABLE_OFFSX+self.TABLE_WIDTH)):
			col = 0
			rownum = int((y+yscrolledoffs-offs)/self.LINE_HEIGHT)
			if x+xscrolledoffs > PrimDirsListWnd.BORDER and x+xscrolledoffs < PrimDirsListWnd.BORDER+self.TABLE_WIDTH:
				pass
			else:
				col = 1

			pdnum = (self.currpage-1)*2*self.LINE_NUM + self.LINE_NUM*col + rownum
			return pdnum < len(self.pds.pds), pdnum
			# (추가) 표 영역 바깥을 클릭한 경우
		return False, None

	def OnPaint(self, event):
		dc = wx.BufferedPaintDC(self, self.buffer, wx.BUFFER_VIRTUAL_AREA)


	def drawBkg(self):
		if self.bw:
			self.bkgclr = (255,255,255)
		else:
			self.bkgclr = self.options.clrbackground

		self.SetBackgroundColour(self.bkgclr)

		tableclr = self.options.clrtable
		if self.bw:
			tableclr = (0,0,0)

		img = Image.new('RGB', (self.WIDTH, self.HEIGHT), self.bkgclr)
		draw = ImageDraw.Draw(img)

		#Title
		BOR = PrimDirsListWnd.BORDER
		draw.rectangle(((BOR, BOR),(BOR+self.TITLE_CELL_WIDTH, BOR+self.TITLE_CELL_HEIGHT)), outline=(tableclr), fill=(self.bkgclr))
		dirtxt = mtexts.typeListDirs[self.options.primarydir]
		keytypetxt = mtexts.txts['DynamicKey']
		if not self.options.pdkeydyn:
			keytypetxt = mtexts.txts['StaticKey']
		keytxt = mtexts.typeListDyn[self.options.pdkeyd]
		if not self.options.pdkeydyn:
			keytxt = mtexts.typeListStat[self.options.pdkeys]

		clr = self.options.clrtexts
		if self.bw:
			clr = (0,0,0)
		txt = dirtxt+', '+keytypetxt+': '+keytxt
		w,h = draw.textsize(txt, self.fntText)
		draw.text((BOR+(self.TITLE_CELL_WIDTH-w)/2, BOR+(self.LINE_HEIGHT-h)/2), txt, fill=clr, font=self.fntText)

		txt = str(self.currpage)+' / '+str(self.maxpage)
		draw.text((BOR+self.TITLE_CELL_WIDTH-self.TITLE_CELL_WIDTH/10, BOR+(self.LINE_HEIGHT-h)/2), txt, fill=clr, font=self.fntText)

		txt = (mtexts.txts['MZ'], mtexts.txts['Prom'], mtexts.txts['DC'], mtexts.txts['Sig'], mtexts.txts['Arc'], mtexts.txts['Date'])
		widths = (self.SMALL_CELL_WIDTH, self.CELL_WIDTH, self.SMALL_CELL_WIDTH, self.CELL_WIDTH, self.CELL_WIDTH, self.BIG_CELL_WIDTH)
		summa = 0
		for i in range(self.COLUMN_NUM):
			w,h = draw.textsize(txt[i], self.fntText)
			draw.text((BOR+summa+(widths[i]-w)/2, BOR+self.LINE_HEIGHT+(self.LINE_HEIGHT-h)/2), txt[i], fill=clr, font=self.fntText)
			summa += widths[i]
		summa = 0
		for i in range(self.COLUMN_NUM):
			w,h = draw.textsize(txt[i], self.fntText)
			draw.text((self.SECOND_TABLE_OFFSX+BOR+summa+(widths[i]-w)/2, BOR+self.LINE_HEIGHT+(self.LINE_HEIGHT-h)/2), txt[i], fill=clr, font=self.fntText)
			summa += widths[i]

		#Tables
		x = BOR
		y = BOR+self.TITLE_CELL_HEIGHT+self.SPACE_TITLEY
		draw.line((x, y, x+self.TABLE_WIDTH, y), fill=tableclr)
		rng = self.to-self.fr #+1!?
		lim = rng
		leftovers = False
		if lim > self.LINE_NUM:
			lim = self.LINE_NUM
			leftovers = True
		idx = self.fr
		for i in range(lim):
			self.drawline(draw, x, y+i*self.LINE_HEIGHT, idx, tableclr)
			idx += 1
		if leftovers:
			x = BOR+self.TABLE_WIDTH+self.SPACE_BETWEEN_TABLESX
			y = BOR+self.TITLE_CELL_HEIGHT+self.SPACE_TITLEY
			draw.line((x, y, x+self.TABLE_WIDTH, y), fill=tableclr)
			lim = rng-self.LINE_NUM##
			idx = self.fr+self.LINE_NUM##
			for i in range(lim):
				self.drawline(draw, x, y+i*self.LINE_HEIGHT, idx, tableclr)
				idx += 1

		wxImg = wx.Image(img.size[0], img.size[1])
		wxImg.SetData(img.tobytes())
		self.buffer = wx.Bitmap(wxImg)


	def	display(self, currpage, fr, to):
		self.currpage = currpage
		self.fr = fr
		self.to = to

		self.drawBkg()
		self.Refresh()


	def drawline(self, draw, x, y, idx, clr):
		#bottom horizontal line
		draw.line((x, y+self.LINE_HEIGHT, x+self.TABLE_WIDTH, y+self.LINE_HEIGHT), fill=clr)

		#vertical lines and PD
		offs = (0, self.SMALL_CELL_WIDTH, self.CELL_WIDTH, self.SMALL_CELL_WIDTH, self.CELL_WIDTH, self.CELL_WIDTH, self.BIG_CELL_WIDTH)

		BOR = PrimDirsListWnd.BORDER
		summa = 0
		txtclr = self.options.clrtexts
		if self.bw:
			txtclr = (0,0,0)
		for i in range(self.COLUMN_NUM+1):
			draw.line((x+summa+offs[i], y, x+summa+offs[i], y+self.LINE_HEIGHT), fill=clr)
			#pd
			if i == 1:#M/Z
				mtxt = mtexts.txts['M']
				if not self.pds.pds[idx].mundane:
					mtxt = mtexts.txts['Z']
				
				w,h = draw.textsize(mtxt, self.fntText)
				draw.text((x+summa+(offs[i]-w)/2, y+(self.LINE_HEIGHT-h)/2), mtxt, fill=txtclr, font=self.fntText)
			elif i == 2:#Prom
				if self.pds.pds[idx].promasp == chart.Chart.MIDPOINT or self.pds.pds[idx].sigasp == chart.Chart.RAPTPAR or self.pds.pds[idx].sigasp == chart.Chart.RAPTCONTRAPAR:
					promtxt = common.common.Planets[self.pds.pds[idx].prom]
					prom2txt = common.common.Planets[self.pds.pds[idx].prom2]

					wp,hp = draw.textsize(promtxt, self.fntMorinus)
					wsp,hsp = draw.textsize(' ', self.fntText)
					wp2,hp2 = draw.textsize(prom2txt, self.fntMorinus)
					offset = (offs[i]-(wp+wsp+wp2))/2
					tclr = (0,0,0)
					if not self.bw:
						if self.options.useplanetcolors:
							objidx = self.pds.pds[idx].prom
							if objidx > astrology.SE_MEAN_NODE:
								objidx = astrology.SE_MEAN_NODE
							tclr = self.options.clrindividual[objidx]
						else:
							tclr = self.clrs[self.chart.dignity(self.pds.pds[idx].prom)]
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hp)/2), promtxt, fill=tclr, font=self.fntMorinus)
					tclr = (0,0,0)
					if not self.bw:
						if self.options.useplanetcolors:
							objidx = self.pds.pds[idx].prom2
							if objidx > astrology.SE_MEAN_NODE:
								objidx = astrology.SE_MEAN_NODE
							tclr = self.options.clrindividual[objidx]
						else:
							tclr = self.clrs[self.chart.dignity(self.pds.pds[idx].prom2)]
					draw.text((x+summa+offset+wp+wsp, y+(self.LINE_HEIGHT-hp2)/2), prom2txt, fill=tclr, font=self.fntMorinus)
				elif self.pds.pds[idx].prom >= primdirs.PrimDir.ANTISCION and self.pds.pds[idx].prom < primdirs.PrimDir.TERM:
					promasptxt = ''
					wspa = 0
					wsp,hsp = draw.textsize(' ', self.fntText)
					if self.pds.pds[idx].promasp != chart.Chart.CONJUNCTIO:
						promasptxt += common.common.Aspects[self.pds.pds[idx].promasp]
						wspa = wsp
					wa,ha = draw.textsize(promasptxt, self.fntAspects)

					anttxt = mtexts.txts['Antis']
					if self.pds.pds[idx].prom >= primdirs.PrimDir.CONTRAANT:
						anttxt = mtexts.txts['ContraAntis']
					wt,ht = draw.textsize(anttxt, self.fntText)

					promtxt = ''
					promfnt = None
					antoffs = 0
					tclr = (0,0,0)
					if self.pds.pds[idx].prom == primdirs.PrimDir.ANTISCIONLOF or self.pds.pds[idx].prom == primdirs.PrimDir.CONTRAANTLOF:
						promtxt = common.common.fortune
						promfnt = self.fntMorinus
						if not self.bw:
							if self.options.useplanetcolors:
								tclr = self.options.clrindividual[astrology.SE_MEAN_NODE+1]
							else:
								tclr = self.options.clrperegrin
					elif self.pds.pds[idx].prom == primdirs.PrimDir.ANTISCIONASC or self.pds.pds[idx].prom == primdirs.PrimDir.CONTRAANTASC:
						promtxt = mtexts.txts['Asc']
						promfnt = self.fntText				
						if not self.bw:
							tclr = txtclr
					elif self.pds.pds[idx].prom == primdirs.PrimDir.ANTISCIONMC or self.pds.pds[idx].prom == primdirs.PrimDir.CONTRAANTMC:
						promtxt = mtexts.txts['MC']
						promfnt = self.fntText				
						if not self.bw:
							tclr = txtclr
					else:
						antoffs = primdirs.PrimDir.ANTISCION
						if self.pds.pds[idx].prom >= primdirs.PrimDir.CONTRAANT:
							antoffs = primdirs.PrimDir.CONTRAANT

						promtxt = common.common.Planets[self.pds.pds[idx].prom-antoffs]
						promfnt = self.fntMorinus

						if not self.bw:
							if self.options.useplanetcolors:
								objidx = self.pds.pds[idx].prom-antoffs
								if objidx == astrology.SE_MEAN_NODE+1:
									objidx = astrology.SE_MEAN_NODE
								elif objidx > astrology.SE_MEAN_NODE+1:
									objidx = astrology.SE_MEAN_NODE+1
								tclr = self.options.clrindividual[objidx]
							else:
								tclr = self.clrs[self.chart.dignity(self.pds.pds[idx].prom-antoffs)]

					wp,hp = draw.textsize(promtxt, promfnt)

					offset = (offs[i]-(wa+wspa+wt+wsp+wp))/2
					if promasptxt != '':
						clrasp = (0,0,0)
						if not self.bw:
							if self.pds.pds[idx].promasp == chart.Chart.PARALLEL or self.pds.pds[idx].promasp == chart.Chart.CONTRAPARALLEL:
								clrasp = self.options.clrperegrin
							else:
								clrasp = self.options.clraspect[self.pds.pds[idx].promasp]
						draw.text((x+summa+offset, y+(self.LINE_HEIGHT-ha)/2), promasptxt, fill=clrasp, font=self.fntAspects)

					draw.text((x+summa+offset+wa+wspa, y+(self.LINE_HEIGHT-ht)/2), anttxt, fill=txtclr, font=self.fntText)
					draw.text((x+summa+offset+wa+wspa+wt+wsp, y+(self.LINE_HEIGHT-hp)/2), promtxt, fill=tclr, font=promfnt)
				elif self.pds.pds[idx].prom >= primdirs.PrimDir.TERM and self.pds.pds[idx].prom < primdirs.PrimDir.FIXSTAR:
					signs = common.common.Signs1
					if not self.options.signs:
						signs = common.common.Signs2
					promtxt = signs[self.pds.pds[idx].prom-primdirs.PrimDir.TERM]
					prom2txt = common.common.Planets[self.pds.pds[idx].prom2]

					wp,hp = draw.textsize(promtxt, self.fntMorinus)
					wsp,hsp = draw.textsize(' ', self.fntText)
					wp2,hp2 = draw.textsize(prom2txt, self.fntMorinus)
					offset = (offs[i]-(wp+wsp+wp2))/2
					sclr = (0,0,0)
					if not self.bw:
						sclr = self.options.clrsigns
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hp)/2), promtxt, fill=sclr, font=self.fntMorinus)
					tclr = (0,0,0)
					if not self.bw:
						if self.options.useplanetcolors:
							objidx = self.pds.pds[idx].prom2
							if objidx > astrology.SE_MEAN_NODE:
								objidx = astrology.SE_MEAN_NODE
							tclr = self.options.clrindividual[objidx]
						else:
							tclr = self.clrs[self.chart.dignity(self.pds.pds[idx].prom2)]
					draw.text((x+summa+offset+wp+wsp, y+(self.LINE_HEIGHT-hp2)/2), prom2txt, fill=tclr, font=self.fntMorinus)
				elif self.pds.pds[idx].prom >= primdirs.PrimDir.FIXSTAR:
					# 코드(nomname)로 식별
					code = self.chart.fixstars.data[self.pds.pds[idx].prom-primdirs.PrimDir.FIXSTAR][fixstars.FixStars.NOMNAME]
					raw  = self.chart.fixstars.data[self.pds.pds[idx].prom-primdirs.PrimDir.FIXSTAR][fixstars.FixStars.NAME]

					if self.options.usetradfixstarnamespdlist:
						# 옵션이 켜져 있으면 전통명/alias 우선
						fallback = None
						trad = (raw or '').strip()
						if trad:
							fallback = trad
						if not fallback:
							fallback = raw or code

						promtxt = astrology.display_fixstar_name(code, self.options, fallback)
					else:
						# 옵션이 꺼져 있으면 NOMNAME(code) 그대로
						promtxt = code

					w,h = draw.textsize(promtxt, self.fntText)
					draw.text((x+summa+(offs[i]-w)/2, y+(self.LINE_HEIGHT-h)/2), promtxt, fill=txtclr, font=self.fntText)
				elif self.pds.pds[idx].prom == primdirs.PrimDir.LOF:
					lofclr = (0,0,0)
					if not self.bw:
						if self.options.useplanetcolors:
							lofclr = self.options.clrindividual[astrology.SE_MEAN_NODE+1]
						else:
							lofclr = self.options.clrperegrin

					promtxt = common.common.fortune
					wp,hp = draw.textsize(promtxt, self.fntMorinus)
					offset = (offs[i]-wp)/2
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hp)/2), promtxt, fill=lofclr, font=self.fntMorinus)
				elif self.pds.pds[idx].prom == primdirs.PrimDir.CUSTOMERPD:
					promtxt = mtexts.txts['Customer2']
					wp,hp = draw.textsize(promtxt, self.fntText)
					offset = (offs[i]-wp)/2
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hp)/2), promtxt, fill=txtclr, font=self.fntText)
				elif self.pds.pds[idx].prom == primdirs.PrimDir.ASC or self.pds.pds[idx].prom == primdirs.PrimDir.MC:
					promasptxt = ''
					if self.pds.pds[idx].promasp != chart.Chart.CONJUNCTIO:
						promasptxt += common.common.Aspects[self.pds.pds[idx].promasp]
					promtxt = mtexts.txts['Asc']
					if self.pds.pds[idx].prom == primdirs.PrimDir.MC:
						promtxt = mtexts.txts['MC']
					wa,ha = draw.textsize(promasptxt, self.fntAspects)
					wsp,hsp = draw.textsize(' ', self.fntText)
					ws,hs = draw.textsize(promtxt, self.fntText)
					offset = (offs[i]-(wa+wsp+ws))/2
					clrasp = (0,0,0)
					if not self.bw:
						if self.pds.pds[idx].promasp == chart.Chart.PARALLEL or self.pds.pds[idx].promasp == chart.Chart.CONTRAPARALLEL:
							clrasp = self.options.clrperegrin
						else:
							clrasp = self.options.clraspect[self.pds.pds[idx].promasp]
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-ha)/2), promasptxt, fill=clrasp, font=self.fntAspects)
					draw.text((x+summa+offset+wa+wsp, y+(self.LINE_HEIGHT-hs)/2), promtxt, fill=txtclr, font=self.fntText)
				elif self.pds.pds[idx].prom >= primdirs.PrimDir.HC2 and self.pds.pds[idx].prom < primdirs.PrimDir.LOF:#Sig is HC
					HCs = (mtexts.txts['HC2'], mtexts.txts['HC3'], mtexts.txts['HC5'], mtexts.txts['HC6'], mtexts.txts['HC8'], mtexts.txts['HC9'], mtexts.txts['HC11'], mtexts.txts['HC12'])
					hctxt = HCs[self.pds.pds[idx].sig-primdirs.PrimDir.HC2]
					ws,hs = draw.textsize(hctxt, self.fntText)
					offset = (offs[i]-ws)/2
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hs)/2), hctxt, fill=txtclr, font=self.fntText)
				else:
					promtxt = common.common.Planets[self.pds.pds[idx].prom]
					promasptxt = ''
					if self.pds.pds[idx].promasp != chart.Chart.CONJUNCTIO:
						promasptxt += common.common.Aspects[self.pds.pds[idx].promasp]
	
					wp,hp = draw.textsize(promtxt, self.fntMorinus)
					wa,ha = draw.textsize(promasptxt, self.fntAspects)
					wsp,hsp = draw.textsize(' ', self.fntText)
					wspa = 0
					if promasptxt != '':
						wspa = wsp
					offset = (offs[i]-(wa+wspa+wp+wsp))/2
					tclr = (0,0,0)
					if promasptxt != '':
						clrasp = (0,0,0)
						if not self.bw:
							if self.pds.pds[idx].promasp == chart.Chart.PARALLEL or self.pds.pds[idx].promasp == chart.Chart.CONTRAPARALLEL:
								clrasp = self.options.clrperegrin
							else:
								clrasp = self.options.clraspect[self.pds.pds[idx].promasp]
						draw.text((x+summa+offset, y+(self.LINE_HEIGHT-ha)/2), promasptxt, fill=clrasp, font=self.fntAspects)
					if not self.bw:
						if self.options.useplanetcolors:
							objidx = self.pds.pds[idx].prom
							if objidx > astrology.SE_MEAN_NODE:
								objidx = astrology.SE_MEAN_NODE
							tclr = self.options.clrindividual[objidx]
						else:
							tclr = self.clrs[self.chart.dignity(self.pds.pds[idx].prom)]
					draw.text((x+summa+offset+wa+wspa, y+(self.LINE_HEIGHT-hp)/2), promtxt, fill=tclr, font=self.fntMorinus)
			elif i == 3:#D/C
				dirtxt = mtexts.txts['D']
				if not self.pds.pds[idx].direct:
					dirtxt = mtexts.txts['C']
				
				w,h = draw.textsize(dirtxt, self.fntText)
				wsp,hsp = draw.textsize(' ', self.fntText)
				warr,harr = draw.textsize('-', self.fntSymbol)
				offset = (offs[i]-(w+wsp+warr))/2
				draw.text((x+summa+offset, y+(self.LINE_HEIGHT-h)/2), dirtxt, fill=txtclr, font=self.fntText)
				draw.text((x+summa+offset+w+wsp, y+(self.LINE_HEIGHT-harr)/2), '-', fill=txtclr, font=self.fntSymbol)
			elif i == 4:#Sig
				#AscMC(+asp), HC, Planet, Asp of a planet, parallel, contraparallel, raptparallel
				#Display aspect(conjuntio also!!) except for Asc,MC,HC
				if self.pds.pds[idx].sigasp == chart.Chart.PARALLEL or self.pds.pds[idx].sigasp == chart.Chart.CONTRAPARALLEL:
					#Par Sig(Asc,Desc,MC,IC)
					partxt = 'X'
					if self.pds.pds[idx].parallelaxis == 0 and self.pds.pds[idx].sigasp == chart.Chart.CONTRAPARALLEL:
						partxt = 'Y'
					wp,hp = draw.textsize(partxt, self.fntAspects)
					sigtxt = common.common.Planets[self.pds.pds[idx].sig]
					ws,hs = draw.textsize(sigtxt, self.fntMorinus)
					wsp,hsp = draw.textsize(' ', self.fntText)
					angles = ('('+mtexts.txts['Asc']+')', '('+mtexts.txts['Dsc']+')', '('+mtexts.txts['MC']+')', '('+mtexts.txts['IC']+')')
					angletxt = ''
					if self.pds.pds[idx].parallelaxis != 0:
						angletxt = angles[self.pds.pds[idx].parallelaxis-primdirs.PrimDir.OFFSANGLES]
					wa,ha = draw.textsize(angletxt, self.fntText)
					offset = (offs[i]-(wp+wsp+ws+wsp+wa))/2
					pclr = (0,0,0)
					if not self.bw:
						pclr = self.options.clrperegrin
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hp)/2), partxt, fill=pclr, font=self.fntAspects)
					tclr = (0,0,0)
					if not self.bw:
						if self.options.useplanetcolors:
							objidx = self.pds.pds[idx].sig
							if objidx > astrology.SE_MEAN_NODE:
								objidx = astrology.SE_MEAN_NODE
							tclr = self.options.clrindividual[objidx]
						else:
							tclr = self.clrs[self.chart.dignity(self.pds.pds[idx].sig)]
					draw.text((x+summa+offset+wp+wsp, y+(self.LINE_HEIGHT-hs)/2), sigtxt, fill=tclr, font=self.fntMorinus)
					draw.text((x+summa+offset+wp+wsp+ws+wsp, y+(self.LINE_HEIGHT-ha)/2), angletxt, fill=txtclr, font=self.fntText)
				elif self.pds.pds[idx].sigasp == chart.Chart.RAPTPAR or self.pds.pds[idx].sigasp == chart.Chart.RAPTCONTRAPAR:
					#R Par (Asc,Desc,MC,IC)
					rapttxt = 'R'
					partxt = 'X'
					wr,hr = draw.textsize(rapttxt, self.fntText)
					wp,hp = draw.textsize(partxt, self.fntAspects)
					wsp,hsp = draw.textsize(' ', self.fntText)
					angles = ('('+mtexts.txts['Asc']+')', '('+mtexts.txts['Dsc']+')', '('+mtexts.txts['MC']+')', '('+mtexts.txts['IC']+')')
					angletxt = angles[self.pds.pds[idx].parallelaxis-primdirs.PrimDir.OFFSANGLES]
					wa,ha = draw.textsize(angletxt, self.fntText)
					offset = (offs[i]-(wr+wp+wsp+wsp+wa))/2
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hr)/2), rapttxt, fill=txtclr, font=self.fntText)
					pclr = (0,0,0)
					if not self.bw:
						pclr = self.options.clrperegrin
					draw.text((x+summa+offset+wr, y+(self.LINE_HEIGHT-hp)/2), partxt, fill=pclr, font=self.fntAspects)
					draw.text((x+summa+offset+wr+wp+wsp, y+(self.LINE_HEIGHT-ha)/2), angletxt, fill=txtclr, font=self.fntText)
				elif self.pds.pds[idx].sig == primdirs.PrimDir.LOF:
					lofclr = (0,0,0)
					if not self.bw:
						if self.options.useplanetcolors:
							lofclr = self.options.clrindividual[astrology.SE_MEAN_NODE+1]
						else:
							lofclr = self.options.clrperegrin

					sigtxt = common.common.fortune
					wp,hp = draw.textsize(sigtxt, self.fntMorinus)

					extra = 0
					offset = (offs[i]-(wp+extra))/2

					if self.pds.pds[idx].mundane:
						sigasptxt = common.common.Aspects[self.pds.pds[idx].sigasp]
						wa,ha = draw.textsize(sigasptxt, self.fntAspects)
						wsp,hsp = draw.textsize(' ', self.fntText)
						extra = wa+wsp
						offset = (offs[i]-(wp+extra))/2
						clrasp = (0,0,0)
						if not self.bw:
							clrasp = self.options.clraspect[self.pds.pds[idx].sigasp]
						draw.text((x+summa+offset, y+(self.LINE_HEIGHT-ha)/2), sigasptxt, fill=clrasp, font=self.fntAspects)

					draw.text((x+summa+offset+extra, y+(self.LINE_HEIGHT-hp)/2), sigtxt, fill=lofclr, font=self.fntMorinus)
				elif self.pds.pds[idx].sig == primdirs.PrimDir.SYZ:
					sigtxt = mtexts.txts['Syzygy']
					wp,hp = draw.textsize(sigtxt, self.fntText)
					offset = (offs[i]-wp)/2
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hp)/2), sigtxt, fill=txtclr, font=self.fntText)
				elif self.pds.pds[idx].sig == primdirs.PrimDir.CUSTOMERPD:
					sigtxt = mtexts.txts['User2']
					wp,hp = draw.textsize(sigtxt, self.fntText)
					offset = (offs[i]-wp)/2
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hp)/2), sigtxt, fill=txtclr, font=self.fntText)
				elif self.pds.pds[idx].sig >= primdirs.PrimDir.OFFSANGLES and self.pds.pds[idx].sig < primdirs.PrimDir.LOF:#Sig is Asc,MC or HC
					if self.pds.pds[idx].sig <= primdirs.PrimDir.IC:
						angles = (mtexts.txts['Asc'], mtexts.txts['Dsc'], mtexts.txts['MC'], mtexts.txts['IC'])
						anglestxt = angles[self.pds.pds[idx].sig-primdirs.PrimDir.OFFSANGLES]
						ws,hs = draw.textsize(anglestxt, self.fntText)
						offset = (offs[i]-ws)/2
						draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hs)/2), anglestxt, fill=txtclr, font=self.fntText)
					else: #=>HC
						HCs = (mtexts.txts['HC2'], mtexts.txts['HC3'], mtexts.txts['HC5'], mtexts.txts['HC6'], mtexts.txts['HC8'], mtexts.txts['HC9'], mtexts.txts['HC11'], mtexts.txts['HC12'])
						hctxt = HCs[self.pds.pds[idx].sig-primdirs.PrimDir.HC2]
						ws,hs = draw.textsize(hctxt, self.fntText)
						offset = (offs[i]-ws)/2
						draw.text((x+summa+offset, y+(self.LINE_HEIGHT-hs)/2), hctxt, fill=txtclr, font=self.fntText)
				else:#interplanetary
					sigasptxt = ''
					if self.pds.pds[idx].sigasp != chart.Chart.CONJUNCTIO:
						sigasptxt = common.common.Aspects[self.pds.pds[idx].sigasp]
					wa,ha = draw.textsize(sigasptxt, self.fntAspects)
					wsp,hsp = draw.textsize(' ', self.fntText)
					wspa = 0
					if sigasptxt != '':
						wspa = wsp
					sigtxt = common.common.Planets[self.pds.pds[idx].sig]
					ws,hs = draw.textsize(sigtxt, self.fntMorinus)
					offset = (offs[i]-(wa+wspa+ws))/2
					clrasp = (0,0,0)
					if not self.bw:
						clrasp = self.options.clraspect[self.pds.pds[idx].sigasp]
					draw.text((x+summa+offset, y+(self.LINE_HEIGHT-ha)/2), sigasptxt, fill=clrasp, font=self.fntAspects)
					tclr = (0,0,0)
					if not self.bw:
						if self.options.useplanetcolors:
							objidx = self.pds.pds[idx].sig
							if objidx > astrology.SE_MEAN_NODE:
								objidx = astrology.SE_MEAN_NODE
							tclr = self.options.clrindividual[objidx]
						else:
							tclr = self.clrs[self.chart.dignity(self.pds.pds[idx].sig)]
					draw.text((x+summa+offset+wa+wspa, y+(self.LINE_HEIGHT-hs)/2), sigtxt, fill=tclr, font=self.fntMorinus)
			elif i == 5:#Arc
				arc = (int(self.pds.pds[idx].arc*1000))/1000.0
				arctxt = str(arc)
				w,h = draw.textsize(arctxt, self.fntText)
				offset = (offs[i]-w)/2
				draw.text((x+summa+offset, y+(self.LINE_HEIGHT-h)/2), arctxt, fill=txtclr, font=self.fntText)
			elif i == 6:#Date
				year, month, day, h = astrology.swe_revjul(self.pds.pds[idx].time, 1)
#				ho, mi, se = util.decToDeg(h)
#				year, month, day, extraday = util.revConvDate(self.pds.pds[idx].time)
				txt = (str(year)).rjust(4)+'.'+(str(month)).zfill(2)+'.'+(str(day)).zfill(2)
				w,h = draw.textsize(txt, self.fntText)
				offset = (offs[i]-w)/2
				draw.text((x+summa+offset, y+(self.LINE_HEIGHT-h)/2), txt, fill=txtclr, font=self.fntText)

			summa += offs[i]
