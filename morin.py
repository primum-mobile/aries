# -*- coding: utf-8 -*-

import wx
import wx.adv
import os
import pickle
# ###########################################
# Roberto change  V 7.2.0
import datetime
# ###########################################
import Image
import astrology
import houses
import planets
import chart
import common
import graphchart
import graphchart2
import revolutions
import suntransits
import secdir
import transits
import personaldatadlg
import findtimedlg
import graphephemdlg
import appearance1dlg
import appearance2dlg
import dignitiesdlg
import colorsdlg
import primarydirsdlg
import primarydirsdlgsmall
import fortunedlg
import arabicpartsdlg
import fixstarsdlg
import triplicitiesdlg
import termsdlg
import decansdlg
# ###########################################
# Roberto change  V 7.2.0
import defaultlocdlg
import windowbehavior
# ###########################################
import ayanamshadlg
import profdlg
import profections
import profectionsframe
import munprofections
import profectionstepperdlg
import proftabledlg
import profstableframe
# ###########################################
# Roberto change  V 7.3.0
import firdariaframe
# ###########################################
import profectiontablestepperdlg
import almutenchartdlg
import almutentopicalsdlg
import almutentopicalsframe
import orbisdlg
import langsdlg
import symbolsdlg
import timespacedlg
import transitmdlg
import revolutionsdlg
import revolutionsoptdlg
import quickchartsoptdlg
import stepalertsdlg
import macfiledialog
import horfileio
import syzygydlg
import suntransitsdlg
import secdirdlg
import stepperdlg
import graphephemframe
import positionsframe
import squarechartframe
import almutenchartframe
import almutenzodsframe
import secdirui
import miscframe
import customerframe
import risesetframe
import speedsframe
import munposframe
import arabicpartsframe
import antisciaframe
# ###################################
# Elias change v 8.0.0
import dodecatemoriaframe
# ###################################
import zodparsframe
import stripframe
import fixstarsframe
import fixstarsaspectsframe
import fixstarsparallelsframe
import hoursframe
import midpointsframe
import aspectsframe
import transitmframe
import transitframe
import secdirframe
import electionsframe
import mundaneframe
import profdlgopts
# ###########################################
# Roberto change  V 7.3.0
import firdariadlg
# ###########################################
import pdsinchartdlgopts
import pdsinchartterrdlgopts
import electionstepperdlg
import zodiacalreleasingframe
import primdirslistframe
import primdirs
import primarykeysdlg
import primdirsrangedlg
import positionswnd
import aspectswnd
import risesetwnd
import hourswnd
import firdariawnd
import arabicpartswnd
import transitmwnd
import profectionswnd
import primdirslistwnd
import miscwnd
import midpointswnd
import speedswnd
import munposwnd
import antisciawnd
import zodparswnd
import stripwnd
import almutenzodswnd
import almutenchartwnd
import fixstarswnd
import fixstarsaspectswnd
import fixstarsparallelswnd
import decennialswnd
import zodiacalreleasingwnd
import phasiswnd
import paranwnd
import eclipseswnd
import angleatbirthwnd
import placidiansapd
import placidianutppd
import regiomontanpd
import campanianpd
import _thread
import options
import util
import symbolic_time
import paranframe
import mtexts
import htmlhelpframe
import customerpd
import ephemcalc
import wx.lib.newevent
import math #solar precession
import circumambulationframe
import circumambulation
import fixstardirsframe
import searchframe
import keyboard_layers
import wxcompat
import workspace_model
import workspace_shell
import chart_session
import horary_session
from morinus import _morinus_user_hors_dir, _morinus_user_images_dir, _copy_missing_tree, _BASE_DIR
import os, sys, wx
import sys  # 위쪽 import들 근처에 이미 있다면 생략
import json
import urllib.request as urllib2
import urllib
import eclipsesframe
import dodecacalcframe

# Temporary UX toggle (Mar 2026): disable popup steppers in chart views.
# Keep the underlying stepper implementation for a later staged re-enable.
ENABLE_SECONDARY_POPUP_STEPPER = False
ENABLE_SOLAR_REVOLUTION_POPUP_STEPPER = False
ENABLE_LUNAR_POPUP_STEPPER = False

# morin.py 상단 어딘가 (import wx 아래)
LANG_MAP = {
	0: wx.LANGUAGE_ENGLISH,            # English
	1: wx.LANGUAGE_HUNGARIAN,          # Hungarian
	2: wx.LANGUAGE_ITALIAN,            # Italian
	3: wx.LANGUAGE_FRENCH,             # French
	4: wx.LANGUAGE_RUSSIAN,            # Russian
	5: wx.LANGUAGE_SPANISH,            # Spanish
	6: wx.LANGUAGE_CHINESE_SIMPLIFIED, # Chinese (Simplified)
	7: wx.LANGUAGE_CHINESE_TRADITIONAL,# Chinese (Traditional)
	8: wx.LANGUAGE_KOREAN,             # Korean
}

def _res_path(name):
	# PyInstaller(onefile/onedir) 모두에서 아이콘을 안정적으로 찾기 위한 경로 헬퍼
	if hasattr(sys, "_MEIPASS"):  # PyInstaller 실행 시 임시 폴더
		return os.path.join(sys._MEIPASS, name)
	return os.path.join(os.path.dirname(os.path.abspath(__file__)), name)


(PDReadyEvent, EVT_PDREADY) = wx.lib.newevent.NewEvent()
pdlock = _thread.allocate_lock()

#menubar

class MFrame(wx.Frame):

	def _apply_custom_shortcut_labels(self):
		keyboard_layers.apply_main_shortcut_labels(self)

	def _handle_quick_shortcut(self, keycode):
		return keyboard_layers.handle_main_quick_shortcut(self, keycode)

	def _apply_radix_overlay_mode(self, new_value):
		if self.splash or self.horoscope is None:
			return False

		current = getattr(self.options, 'showfixstars', options.Options.NONE)
		if current == new_value:
			return False

		self.options.showfixstars = new_value
		self.enableOptMenus(True)

		if new_value == options.Options.FIXSTARS:
			try:
				self.horoscope.rebuildFixStars()
			except Exception:
				pass
		elif new_value == options.Options.ARABICPARTS:
			try:
				self.horoscope.calcArabicParts()
			except Exception:
				pass
		elif new_value in (options.Options.ANTIS, options.Options.CANTIS, options.Options.DODECATEMORIA):
			try:
				self.horoscope.calcAntiscia()
			except Exception:
				pass

		if getattr(self.options, 'autosave', False):
			try:
				if self.options.saveAppearance1():
					self.moptions.Enable(self.ID_SaveOpts, True)
			except Exception:
				pass

		self.drawBkg()
		self.Refresh()
		self.refreshOpenWindows()
		return True

	def _refresh_radix_after_appearance_change(self):
		self.enableOptMenus(True)
		if getattr(self.options, 'autosave', False):
			try:
				if self.options.saveAppearance1():
					self.moptions.Enable(self.ID_SaveOpts, True)
			except Exception:
				pass
		self.drawBkg()
		self.Refresh()
		self.refreshOpenWindows()

	def _toggle_radix_display_option(self, attr_name):
		if self.splash or self.horoscope is None:
			return False
		if not hasattr(self.options, attr_name):
			return False
		setattr(self.options, attr_name, not bool(getattr(self.options, attr_name)))
		self._refresh_radix_after_appearance_change()
		return True

	def _cycle_natal_secondary_ring(self):
		if self.splash or self.horoscope is None:
			return False

		current = getattr(self.options, 'showfixstars', options.Options.NONE)
		cycle = (
			options.Options.DODECATEMORIA,
			options.Options.ARABICPARTS,
			options.Options.FIXSTARS,
			options.Options.ANTIS,
			options.Options.CANTIS,
			options.Options.NONE,
		)
		try:
			index = cycle.index(current)
		except ValueError:
			index = 0
		new_value = cycle[(index + 1) % len(cycle)]
		return self._apply_radix_overlay_mode(new_value)

	def onCycleNatalSecondaryRing(self, event):
		if self._cycle_natal_secondary_ring():
			return
		if event is not None:
			event.Skip()

	def onRadixOverlayMenu(self, event):
		mode = self._radix_overlay_mode_by_id.get(event.GetId())
		if mode is None:
			event.Skip()
			return
		if not self._apply_radix_overlay_mode(mode):
			event.Skip()

	def onRadixDisplayToggleMenu(self, event):
		toggle_spec = self._radix_display_toggle_by_id.get(event.GetId())
		if toggle_spec is None:
			event.Skip()
			return
		if not self._toggle_radix_display_option(toggle_spec[0]):
			event.Skip()

	def onChartContextMenu(self, event):
		if self.splash or self.horoscope is None:
			if event is not None:
				event.Skip()
			return

		menu = wx.Menu()
		current = getattr(self.options, 'showfixstars', options.Options.NONE)
		for item_id, label, mode in self._radix_overlay_menu_specs:
			item = menu.AppendRadioItem(item_id, label)
			if current == mode:
				item.Check(True)
		menu.AppendSeparator()
		for item_id, (attr_name, label) in self._radix_display_toggle_by_id.items():
			item = menu.AppendCheckItem(item_id, label)
			item.Check(bool(getattr(self.options, attr_name, False)))

		pos = wx.DefaultPosition
		try:
			screen_pos = event.GetPosition()
			if screen_pos == wx.DefaultPosition or getattr(screen_pos, 'x', -1) < 0 or getattr(screen_pos, 'y', -1) < 0:
				screen_pos = wx.GetMousePosition()
			pos = self.ScreenToClient(screen_pos)
		except Exception:
			pass

		self.PopupMenu(menu, pos)
		menu.Destroy()

	def onCharHook(self, event):
		cs = self._active_chart_session()
		if cs is not None:
			if keyboard_layers.handle_transit_key_event(cs, event):
				return
		if keyboard_layers.handle_main_key_event(self, event):
			return

		event.Skip()

	def onKeyDown(self, event):
		cs = self._active_chart_session()
		if cs is not None:
			if keyboard_layers.handle_transit_key_event(cs, event):
				return
		if keyboard_layers.handle_main_key_event(self, event):
			return

		event.Skip()

	def _render_target_size(self):
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			size = self._workspace_shell.get_chart_host_size()
			if getattr(size, 'x', 0) > 0 and getattr(size, 'y', 0) > 0:
				return size
		return self.GetClientSize()

	def _display_client_rect(self):
		try:
			display_index = wx.Display.GetFromWindow(self)
			if display_index == wx.NOT_FOUND and wx.Display.GetCount() > 0:
				display_index = 0
			if display_index != wx.NOT_FOUND:
				return wx.Display(display_index).GetClientArea()
		except Exception:
			pass
		return wx.Rect(0, 0, 1440, 900)

	def _fit_workspace_startup_geometry(self):
		if not hasattr(self, '_workspace_shell') or self._workspace_shell is None:
			return

		rect = self._display_client_rect()
		target_side = max(1, int(rect.height * 0.80))
		sidebar_width = max(140, int(self._workspace_shell.get_preferred_sidebar_width()))
		extra_content_width = 18

		client_width = sidebar_width + target_side + extra_content_width
		client_height = target_side + 36

		for _ in range(3):
			self.SetClientSize((client_width, client_height))
			self.Layout()
			host_size = self._workspace_shell.chart_host.GetClientSize()
			dx = target_side - int(getattr(host_size, 'x', 0))
			dy = target_side - int(getattr(host_size, 'y', 0))
			if abs(dx) <= 1 and abs(dy) <= 1:
				break
			client_width = max(900, client_width + dx)
			client_height = max(676, client_height + dy)

		self.Layout()
		self._workspace_shell.refresh_navigation()

		frame_rect = self.GetScreenRect()
		host_rect = self._workspace_shell.chart_host.GetScreenRect()
		host_center_offset_x = (host_rect.x - frame_rect.x) + int(host_rect.width / 2)

		target_center_x = rect.x + int(rect.width / 2)
		target_center_y = rect.y + int(rect.height / 2)

		new_x = target_center_x - host_center_offset_x
		new_y = target_center_y - int(frame_rect.height / 2)

		min_x = rect.x
		max_x = rect.x + rect.width - frame_rect.width
		min_y = rect.y
		max_y = rect.y + rect.height - frame_rect.height

		if max_x < min_x:
			max_x = min_x
		if max_y < min_y:
			max_y = min_y

		new_x = min(max(new_x, min_x), max_x)
		new_y = min(max(new_y, min_y), max_y)
		self.SetPosition((new_x, new_y))

	def _shell_background_colour(self):
		if self.options.bw:
			return (255, 255, 255)
		return self.options.clrbackground

	def _push_chart_bitmap(self, bitmap, center=False):
		self.buffer = bitmap
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			self._workspace_shell.set_chart_bitmap(
				bitmap,
				center=center,
				background_colour=self._shell_background_colour(),
			)

	def _refresh_chart_host(self):
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			self._workspace_shell.refresh_chart()
		else:
			self.Refresh()

	def _refresh_workspace_navigation(self):
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			self._workspace_shell.refresh_navigation()

	def _refresh_workspace_shell_theme(self):
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			self._workspace_shell.refresh_theme()

	def _show_table_in_workspace(self, action_id, wnd):
		self._active_table_action = action_id
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			self._workspace_shell.set_table_content(wnd)
			self._workspace_shell.navigator_pane.set_active_action(action_id)

	def _handle_chart_host_resize(self):
		if not hasattr(self, 'splash'):
			return
		if self.splash:
			self._refresh_chart_host()
			return
		if getattr(self, 'horoscope', None) is None:
			return
		self.drawBkg()

	def _workspace_recent_files(self):
		recent_files = []
		for path in getattr(self, '_recent_hors_paths', []):
			recent_files.append({
				'label': os.path.basename(path),
				'path': path,
			})
		return recent_files

	def _workspace_hors_files(self):
		hors_files = []
		if not os.path.isdir(self.fpathhors):
			return hors_files

		paths = []
		for name in os.listdir(self.fpathhors):
			if not name.lower().endswith('.hor'):
				continue
			path = os.path.join(self.fpathhors, name)
			if os.path.isfile(path):
				paths.append(path)

		paths.sort(
			key=lambda path: (
				0 if path == self.fpath else 1,
				-int(os.path.getmtime(path)) if os.path.exists(path) else 0,
				os.path.basename(path).lower(),
			)
		)

		for path in paths[:24]:
			hors_files.append({
				'label': os.path.basename(path),
				'path': path,
			})
		return hors_files

	def _workspace_session_title(self, chrt, fpath=''):
		name = getattr(chrt, 'name', '') or ''
		if not name and fpath:
			name = os.path.splitext(os.path.basename(fpath))[0]
		if not name:
			name = mtexts.txts['Untitled']
		return name

	def _workspace_session_subtitle(self, chrt):
		try:
			return mtexts.typeList[chrt.htype]
		except Exception:
			return ''

	def _find_workspace_session(self, session_id):
		return getattr(self, '_workspace_runtime', {}).get(session_id)

	def _find_workspace_session_by_chart_session(self, cs):
		for session in getattr(self, '_workspace_runtime', {}).values():
			if session.get('chart_session') is cs:
				return session
		return None

	def _find_workspace_document_id_for_chart(self, chrt):
		if chrt is None:
			return None
		for document_id, session in getattr(self, '_workspace_runtime', {}).items():
			if session.get('chart') is chrt:
				return document_id
			cs = session.get('chart_session')
			if cs is not None and cs.chart is chrt:
				return document_id
		return None

	def _collect_workspace_descendant_ids(self, parent_document_id):
		descendants = []
		queue = [parent_document_id]
		while queue:
			current_parent = queue.pop(0)
			for document_id, session in getattr(self, '_workspace_runtime', {}).items():
				if document_id == parent_document_id or document_id in descendants:
					continue
				if session.get('parent_document_id') == current_parent:
					descendants.append(document_id)
					queue.append(document_id)
		return descendants

	def _workspace_document_insert_index(self, parent_document_id=None):
		documents = list(self._workspace_state.documents())
		if not documents:
			return 0
		if parent_document_id is None:
			return len(documents)

		branch_ids = set(self._collect_workspace_descendant_ids(parent_document_id))
		branch_ids.add(parent_document_id)
		last_branch_index = -1
		for index, document in enumerate(documents):
			if getattr(document, 'document_id', None) in branch_ids:
				last_branch_index = index
		if last_branch_index >= 0:
			return last_branch_index + 1
		return len(documents)

	def _pd_arc_years_per_degree(self):
		opts = self.options
		if opts.pdkeydyn:
			coeff = primdirs.PrimDirs.staticData[primdirs.PrimDirs.NAIBOD][primdirs.PrimDirs.COEFF]
			return coeff if coeff > 0.0 else 1.0
		if opts.pdkeys == primdirs.PrimDirs.CUSTOMER:
			deg_per_year = opts.pdkeydeg + opts.pdkeymin / 60.0 + opts.pdkeysec / 3600.0
			if deg_per_year <= 0.0:
				return 1.0
			return 1.0 / deg_per_year
		coeff = primdirs.PrimDirs.staticData[opts.pdkeys][primdirs.PrimDirs.COEFF]
		return coeff if coeff > 0.0 else 1.0

	def _format_pd_date_and_age(self, cs):
		if cs is None or cs.radix is None or cs.chart is None:
			return None
		if cs.chart.htype != chart.Chart.PDINCHART:
			return None

		t = cs.chart.time
		date_txt = '%04d-%02d-%02d %02d:%02d:%02d' % (
			t.origyear, t.origmonth, t.origday,
			t.hour, t.minute, t.second,
		)
		arc_abs = None
		try:
			arc_abs = float(getattr(cs.chart, '_pd_arc_abs'))
		except Exception:
			arc_abs = None
		if arc_abs is None:
			arc_abs = math.fabs(float(cs.chart.time.jd - cs.radix.time.jd)) / 365.2425
		age_years = arc_abs * self._pd_arc_years_per_degree()
		return date_txt, age_years

	def _format_secondary_symbolic_date_and_age(self, cs):
		if cs is None or cs.radix is None or cs.chart is None:
			return None
		if cs.chart.htype != chart.Chart.TRANSIT:
			return None
		if not isinstance(getattr(cs, '_stepper', None), stepperdlg.StepperDlg):
			return None

		info = symbolic_time.secondary_direction_symbolic_info(cs.radix, cs.chart)
		if info is None:
			return None

		sy, sm, sd, sh, smi, ss = info['progressed_datetime']
		ry, rm, rd, rh, rmi, rs = info['signified_datetime']
		date_txt = 'Symbolic: %04d-%02d-%02d %02d:%02d:%02d • Real: %04d-%02d-%02d %02d:%02d:%02d' % (
			sy, sm, sd, sh, smi, ss,
			ry, rm, rd, rh, rmi, rs,
		)
		return date_txt, info['age_years']

	def _format_secondary_real_date_and_age(self, cs):
		if cs is None or cs.radix is None or cs.chart is None:
			return None
		if cs.chart.htype != chart.Chart.TRANSIT:
			return None
		if not isinstance(getattr(cs, '_stepper', None), stepperdlg.StepperDlg):
			return None

		info = symbolic_time.secondary_direction_symbolic_info(cs.radix, cs.chart)
		if info is None:
			return None

		ry, rm, rd, rh, rmi, rs = info['signified_datetime']
		date_txt = '%04d-%02d-%02d' % (
			ry, rm, rd,
		)
		return date_txt, info['age_years']

	def _format_profection_real_date_and_age(self, cs):
		# Returns (date_txt, age_years) for a profection session, using display_datetime (real date).
		if cs is None or cs.radix is None or cs.chart is None:
			return None
		if cs.chart.htype != chart.Chart.PROFECTION:
			return None
		dt = getattr(cs, 'display_datetime', None)
		if dt is None:
			return None
		dy, dm, dd, dh, dmi, ds = dt
		date_txt = '%04d-%02d-%02d' % (dy, dm, dd)
		try:
			calflag = symbolic_time._calflag_from_chart(cs.radix)
			ut_disp = float(dh) + float(dmi) / 60.0 + float(ds) / 3600.0
			disp_jd = astrology.swe_julday(int(dy), int(dm), int(dd), ut_disp, calflag)
			age_years = (disp_jd - float(cs.radix.time.jd)) / 365.2425
		except Exception:
			age_years = 0.0
		return date_txt, age_years

	def _format_solar_real_date_and_age(self, cs):
		# Returns (date_txt, age_years) for a solar revolution session.
		if cs is None or cs.radix is None or cs.chart is None:
			return None
		if cs.chart.htype != chart.Chart.SOLAR:
			return None
		dt = getattr(cs, 'display_datetime', None)
		if dt is None:
			t = cs.chart.time
			dt = (int(t.year), int(t.month), int(t.day), int(t.hour), int(t.minute), int(t.second))
		dy, dm, dd, dh, dmi, ds = dt
		date_txt = '%04d-%02d-%02d' % (dy, dm, dd)
		try:
			calflag = symbolic_time._calflag_from_chart(cs.radix)
			ut_disp = float(dh) + float(dmi) / 60.0 + float(ds) / 3600.0
			disp_jd = astrology.swe_julday(int(dy), int(dm), int(dd), ut_disp, calflag)
			age_years = (disp_jd - float(cs.radix.time.jd)) / 365.2425
		except Exception:
			age_years = 0.0
		return date_txt, age_years

	def _format_lunar_real_date_and_age(self, cs):
		# Returns (date_txt, age_years) for a lunar revolution session.
		if cs is None or cs.radix is None or cs.chart is None:
			return None
		if cs.chart.htype != chart.Chart.LUNAR:
			return None
		dt = getattr(cs, 'display_datetime', None)
		if dt is None:
			t = cs.chart.time
			dt = (int(t.year), int(t.month), int(t.day), int(t.hour), int(t.minute), int(t.second))
		dy, dm, dd, dh, dmi, ds = dt
		date_txt = '%04d-%02d-%02d' % (dy, dm, dd)
		try:
			calflag = symbolic_time._calflag_from_chart(cs.radix)
			ut_disp = float(dh) + float(dmi) / 60.0 + float(ds) / 3600.0
			disp_jd = astrology.swe_julday(int(dy), int(dm), int(dd), ut_disp, calflag)
			age_years = (disp_jd - float(cs.radix.time.jd)) / 365.2425
		except Exception:
			age_years = 0.0
		return date_txt, age_years

	def _update_workspace_pd_runtime_title(self, cs):
		session = self._find_workspace_session_by_chart_session(cs)
		if session is None:
			return

		info = self._format_pd_date_and_age(cs)
		if info is None:
			return
		date_txt, age_years = info

		base_title = session.get('base_title')
		if not base_title:
			document = self._workspace_state.find_document(session['document_id'])
			base_title = document.title if document is not None else self._workspace_session_title(cs.chart, session.get('fpath', ''))
			session['base_title'] = base_title

		new_title = '%s • %s • Age: %.2fy' % (base_title, date_txt, age_years)
		self._workspace_state.update_document(session['document_id'], title=new_title)
		if self._workspace_state.active_document_id() == session['document_id']:
			self._refresh_workspace_navigation()

	def _update_workspace_symbolic_runtime_title(self, cs):
		session = self._find_workspace_session_by_chart_session(cs)
		if session is None:
			return

		info = self._format_secondary_symbolic_date_and_age(cs)
		if info is None:
			return
		date_txt, age_years = info

		base_title = session.get('base_title')
		if not base_title:
			document = self._workspace_state.find_document(session['document_id'])
			base_title = document.title if document is not None else self._workspace_session_title(cs.chart, session.get('fpath', ''))
			session['base_title'] = base_title

		new_title = '%s • %s • Age: %.2fy' % (base_title, date_txt, age_years)
		self._workspace_state.update_document(session['document_id'], title=new_title)
		if self._workspace_state.active_document_id() == session['document_id']:
			self._refresh_workspace_navigation()

	def _update_workspace_profection_runtime_title(self, cs):
		session = self._find_workspace_session_by_chart_session(cs)
		if session is None:
			return

		info = self._format_profection_real_date_and_age(cs)
		if info is None:
			return
		date_txt, age_years = info

		base_title = session.get('base_title')
		if not base_title:
			document = self._workspace_state.find_document(session['document_id'])
			base_title = document.title if document is not None else self._workspace_session_title(cs.chart, session.get('fpath', ''))
			session['base_title'] = base_title

		new_title = '%s • %s • Age: %.2fy' % (base_title, date_txt, age_years)
		self._workspace_state.update_document(session['document_id'], title=new_title)
		if self._workspace_state.active_document_id() == session['document_id']:
			self._refresh_workspace_navigation()

	def _update_workspace_solar_runtime_title(self, cs):
		session = self._find_workspace_session_by_chart_session(cs)
		if session is None:
			return

		info = self._format_solar_real_date_and_age(cs)
		if info is None:
			return
		date_txt, age_years = info

		base_title = session.get('base_title')
		if not base_title:
			document = self._workspace_state.find_document(session['document_id'])
			base_title = document.title if document is not None else self._workspace_session_title(cs.chart, session.get('fpath', ''))
			session['base_title'] = base_title

		new_title = '%s • %s • Age: %.2fy' % (base_title, date_txt, age_years)
		self._workspace_state.update_document(session['document_id'], title=new_title)
		if self._workspace_state.active_document_id() == session['document_id']:
			self._refresh_workspace_navigation()

	def _update_workspace_lunar_runtime_title(self, cs):
		session = self._find_workspace_session_by_chart_session(cs)
		if session is None:
			return

		info = self._format_lunar_real_date_and_age(cs)
		if info is None:
			return
		date_txt, age_years = info

		base_title = session.get('base_title')
		if not base_title:
			document = self._workspace_state.find_document(session['document_id'])
			base_title = document.title if document is not None else self._workspace_session_title(cs.chart, session.get('fpath', ''))
			session['base_title'] = base_title

		new_title = '%s • %s • Age: %.2fy' % (base_title, date_txt, age_years)
		self._workspace_state.update_document(session['document_id'], title=new_title)
		if self._workspace_state.active_document_id() == session['document_id']:
			self._refresh_workspace_navigation()

	def _secondary_display_datetime_for_chart(self, chrt, radix):
		info = symbolic_time.secondary_direction_symbolic_info(radix, chrt)
		if info is None:
			return None
		return info['signified_datetime']

	def _activate_workspace_session(self, session):
		if isinstance(session, str):
			session = self._find_workspace_session(session)
		if session is None:
			return

		cs = session.get('chart_session')
		if cs is not None:
			self.horoscope = cs.chart
		else:
			self.horoscope = session['chart']
		self.splash = False
		self.fpath = session.get('fpath', '')
		self.fpathhors = session.get('dpath') or self.fpathhors
		self.dirty = False
		self._workspace_state.activate_document(session['document_id'])

		self._active_table_action = None
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			self._workspace_shell.clear_table_content()
			self._workspace_shell.navigator_pane.set_active_action(None)

		self.enableMenus(True)
		self.drawBkg()
		self.Refresh()
		self.handleStatusBar(True)
		self.handleCaption(True)
		self._refresh_workspace_navigation()
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			wx.CallAfter(self._workspace_shell.chart_host.SetFocus)
		else:
			wx.CallAfter(self.SetFocus)

	def _active_chart_session(self):
		active_id = self._workspace_state.active_document_id()
		if active_id is None:
			return None
		session = self._find_workspace_session(active_id)
		if session is None:
			return None
		return session.get('chart_session')

	def _on_chart_session_change(self, cs):
		self.horoscope = cs.chart
		self._update_workspace_pd_runtime_title(cs)
		self._update_workspace_symbolic_runtime_title(cs)
		self._update_workspace_profection_runtime_title(cs)
		self._update_workspace_solar_runtime_title(cs)
		self._update_workspace_lunar_runtime_title(cs)
		self.drawBkg()
		self.Refresh()
		self.handleStatusBar(True)
		self.handleCaption(True)

	def _make_stepper_callback(self, cs):
		def on_step(chrt, caption, *args):
			display_datetime = None
			try:
				if len(args) >= 4:
					y = int(args[0])
					m = int(args[1])
					d = int(args[2])
					t = float(args[3])
					h, mi, s = util.decToDeg(t)
					display_datetime = (y, m, d, int(h), int(mi), int(s))
			except Exception:
				pass
			if display_datetime is None:
				try:
					if isinstance(getattr(cs, '_stepper', None), stepperdlg.StepperDlg):
						display_datetime = self._secondary_display_datetime_for_chart(chrt, cs.radix)
				except Exception:
					pass
			cs.change_chart(chrt, display_datetime=display_datetime)
		return on_step

	def _open_workspace_session(self, chrt, fpath='', dpath='', session_label=None, add_to_history=False,
							  radix=None, view_mode=0, navigation_units=None, navigation_title_label=None, stepper=None,
							  display_datetime=None, parent_document_id_override=None, indent_level_override=None):
		if chrt is None:
			return None

		if indent_level_override is not None:
			indent_level = max(0, int(indent_level_override))
		else:
			indent_level = 0

		if parent_document_id_override is not None:
			parent_document_id = parent_document_id_override
		else:
			parent_document_id = None

		if parent_document_id_override is None and radix is not None and chrt is not radix:
			if indent_level_override is None:
				indent_level = 1
			parent_document_id = self._find_workspace_document_id_for_chart(radix)

		document = self._workspace_state.open_document(
			kind='chart',
			title=session_label or self._workspace_session_title(chrt, fpath),
			subtitle=self._workspace_session_subtitle(chrt),
			path=fpath,
			indent_level=indent_level,
			insert_index=self._workspace_document_insert_index(parent_document_id),
		)
		session = {
			'document_id': document.document_id,
			'chart': chrt,
			'fpath': fpath,
			'dpath': dpath or self.fpathhors,
			'base_title': session_label or self._workspace_session_title(chrt, fpath),
			'parent_document_id': parent_document_id,
			'chart_session': None,
		}
		if radix is not None:
			cs = chart_session.ChartSession(
				chrt, radix, self.options,
				view_mode=view_mode,
				navigation_units=navigation_units,
				navigation_title_label=navigation_title_label,
				stepper=stepper,
				on_change=self._on_chart_session_change,
				display_datetime=display_datetime,
			)
			session['chart_session'] = cs
		self._workspace_runtime[document.document_id] = session

		if add_to_history and fpath:
			self._recent_hors_paths = [path for path in self._recent_hors_paths if path != fpath]
			self._recent_hors_paths.insert(0, fpath)
			self._recent_hors_paths = self._recent_hors_paths[:9]
			self.filehistory.AddFileToHistory(fpath)

		self._activate_workspace_session(document.document_id)
		return document

	def _switch_workspace_session(self, session_id):
		self._activate_workspace_session(session_id)

	def _workspace_open_chart(self, event=None):
		if sys.platform == 'darwin':
			fpath = macfiledialog.choose_file(self.fpathhors)
			if not fpath:
				return
			dpath = os.path.dirname(fpath)
			if not fpath.lower().endswith(u'.hor'):
				fpath += u'.hor'
			chrt = self.subLoad(fpath, dpath, True)
			if chrt is not None:
				self._open_workspace_session(chrt, fpath=fpath, dpath=dpath, add_to_history=True)
			return

		dlg = wx.FileDialog(self, mtexts.txts['OpenHor'], '', '', u'All files (*.*)|*.*', wx.FD_OPEN)
		try:
			if os.path.isdir(self.fpathhors):
				dlg.SetDirectory(self.fpathhors)
			else:
				dlg.SetDirectory(u'.')
			if dlg.ShowModal() == wx.ID_OK:
				dpath = dlg.GetDirectory()
				fpath = dlg.GetPath()
				if not fpath.lower().endswith(u'.hor'):
					fpath += u'.hor'
				chrt = self.subLoad(fpath, dpath, True)
				if chrt is not None:
					self._open_workspace_session(chrt, fpath=fpath, dpath=dpath, add_to_history=True)
		finally:
			dlg.Destroy()

	def _workspace_new_chart(self, event=None):
		dlg = personaldatadlg.PersonalDataDlg(self, self.options.langid)
		dlg.CenterOnParent()
		dlg.initialize()
		val = dlg.ShowModal()
		if val == wx.ID_OK:
			direc = dlg.placerbE.GetValue()
			hemis = dlg.placerbN.GetValue()
			place = chart.Place(dlg.birthplace.GetValue(), int(dlg.londeg.GetValue()), int(dlg.lonmin.GetValue()), 0, direc, int(dlg.latdeg.GetValue()), int(dlg.latmin.GetValue()), 0, hemis, int(dlg.alt.GetValue()))
			time = self._chart_time_from_dialog(dlg, place)
			male = dlg.genderrbM.GetValue()
			chrt = chart.Chart(dlg.name.GetValue(), male, time, place, dlg.typecb.GetCurrentSelection(), dlg.notes.GetValue(), self.options)
			self._open_workspace_session(chrt)
		dlg.Destroy()

	def _workspace_open_here_and_now(self, event=None):
		place = chart.Place(self.options.deflocname, self.options.defloclondeg, self.options.defloclonmin, 0, self.options.defloceast, self.options.defloclatdeg, self.options.defloclatmin, 0, self.options.deflocnorth, self.options.deflocalt)
		now = datetime.datetime.now()
		time = chart.Time(now.year, now.month, now.day, now.hour, now.minute, now.second, False, chart.Time.GREGORIAN, chart.Time.ZONE, self.options.deflocplus, self.options.defloczhour, self.options.defloczminute, self.options.deflocdst, place, tzid=getattr(self.options, 'defloctzid', ''), tzauto=getattr(self.options, 'defloctzauto', True))
		chrt = chart.Chart(mtexts.txts['HereAndNow'], True, time, place, chart.Chart.HORARY, '', self.options)

		document = self._workspace_state.open_document(
			kind='chart',
			title=mtexts.txts['HereAndNow'],
			subtitle=self._workspace_session_subtitle(chrt),
		)
		cs = horary_session.HorarySession(
			chrt, self.options,
			on_change=self._on_chart_session_change,
			navigation_title_label=mtexts.txts['HereAndNow'],
		)
		session = {
			'document_id': document.document_id,
			'chart': chrt,
			'fpath': '',
			'dpath': '',
			'chart_session': cs,
		}
		self._workspace_runtime[document.document_id] = session
		self._activate_workspace_session(document.document_id)

	def _build_configured_solar_revolution_chart(self):
		radix = self._active_radix_chart()
		revs = revolutions.Revolutions()
		target_year = self._get_configured_solar_return_year()
		ok = revs.compute(revolutions.Revolutions.SOLAR, target_year, radix.time.month, radix.time.day, radix)
		if not ok:
			dlgm = wx.MessageDialog(self, mtexts.txts['CouldnotComputeRevolution'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return (None, None)

		t1, t2, t3, t4, t5, t6 = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]
		if self.options.ayanamsha != 0:
			try:
				t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, astrology.SE_SUN)
			except Exception:
				pass

		ti = (t1, t2, t3, t4, t5, t6, chart.Time.GREGORIAN, chart.Time.GREENWICH, 0, 0)
		place = radix.place
		plus = True

		if getattr(self.options, 'revolutions_solarlocationmode', 0) == 1:
			dlg = timespacedlg.TimeSpaceDlg(self, mtexts.txts['Revolutions'], self.options.langid)
			dlg.initialize(radix, ti)
			dlg.CenterOnParent()
			if dlg.ShowModal() != wx.ID_OK:
				dlg.Destroy()
				return (None, None)
			place = self._build_revolution_place(dlg)
			if self.options.ayanamsha != 0:
				try:
					t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, astrology.SE_SUN, topo_place=place, seed=(t1, t2, t3, t4, t5, t6))
				except Exception:
					pass
			if dlg.pluscb.GetCurrentSelection() == 1:
				plus = False
			dlg.Destroy()
		else:
			if self.options.ayanamsha != 0:
				try:
					t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, astrology.SE_SUN, topo_place=place, seed=(t1, t2, t3, t4, t5, t6))
				except Exception:
					pass

		time = chart.Time(t1, t2, t3, t4, t5, t6, False, radix.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)
		revolution = chart.Chart(radix.name, radix.male, time, place, chart.Chart.SOLAR, '', self.options, False)
		label = self._workspace_timed_label(mtexts.typeList[chart.Chart.SOLAR], time.year, time.month, time.day, time.hour, time.minute)
		return (revolution, label)

	def _workspace_open_solar_return(self, event=None):
		radix = self._active_radix_chart()
		chrt, label = self._build_configured_solar_revolution_chart()
		if chrt is None:
			return
		t = chrt.time
		self._open_workspace_session(
			chrt, fpath=self.fpath, dpath=self.fpathhors, session_label=label,
			radix=radix, view_mode=chart_session.ChartSession.CHART,
			display_datetime=(t.year, t.month, t.day, t.hour, t.minute, t.second),
		)

	def _workspace_navigation_state(self):
		has_chart = (not self.splash) and getattr(self, 'horoscope', None) is not None
		solar_available = has_chart and not self.horoscope.time.bc
		enabled_actions = {
			'new_chart': True,
			'open_chart': True,
			'here_and_now': True,
			'synastry': has_chart,
			'transits': has_chart,
			'sun_transits': has_chart,
			'solar_return': solar_available,
			'lunar_return': solar_available,
			'other_revolutions': has_chart,
			'secondary_chart': has_chart,
			'secondary_positions': has_chart,
			'profections_chart': has_chart,
			'exact_transits': has_chart,
			'profections_table': has_chart,
			'primary_directions': has_chart,
			'positions': has_chart,
			'aspects': has_chart,
			'rise_set': has_chart,
			'planetary_hours': has_chart,
			'firdaria': has_chart,
			'arabic_parts': has_chart,
			'eclipses': has_chart,
			'angle_at_birth': has_chart,
			'misc': has_chart,
			'midpoints': has_chart,
			'speeds': has_chart,
			'mundane_positions': has_chart,
			'antiscia': has_chart,
			'zodpars': has_chart,
			'strip': has_chart,
			'almuten_zodiacal': has_chart,
			'almuten_chart': has_chart,
			'fixed_stars': has_chart,
			'fixed_stars_aspects': has_chart,
			'fixed_stars_parallels': has_chart,
			'circumambulation': has_chart,
			'zodiacal_releasing': has_chart,
			'decennials': has_chart,
			'phasis': has_chart,
			'paranatellonta': has_chart,
		}
		return self._workspace_state.build_sidebar_state(enabled_actions)

	def _handle_workspace_action(self, action_id):
		action_map = {
			'new_chart': self._workspace_new_chart,
			'open_chart': self._workspace_open_chart,
			'here_and_now': self._workspace_open_here_and_now,
			'synastry': self.onSynastry,
			'transits': self.onTransits,
			'sun_transits': self.onSunTransits,
			'solar_return': self.onQuickSolarRevolution,
			'lunar_return': self.onQuickLunarRevolution,
			'other_revolutions': self.onRevolutions,
			'secondary_chart': self.onSecondaryDirs,
			'secondary_positions': self.onSecProgPositionsByDate,
			'profections_chart': self.onProfectionsChart,
			'positions': lambda e: self._workspace_table_positions(),
			'aspects': lambda e: self._workspace_table_aspects(),
			'rise_set': lambda e: self._workspace_table_rise_set(),
			'exact_transits': lambda e: self._workspace_table_exact_transits(),
			'profections_table': lambda e: self._workspace_table_profections(),
			'primary_directions': lambda e: self._workspace_table_primary_dirs(),
			'planetary_hours': lambda e: self._workspace_table_planetary_hours(),
			'firdaria': lambda e: self._workspace_table_firdaria(),
			'arabic_parts': lambda e: self._workspace_table_arabic_parts(),
			'misc': lambda e: self._workspace_table_misc(),
			'midpoints': lambda e: self._workspace_table_midpoints(),
			'speeds': lambda e: self._workspace_table_speeds(),
			'mundane_positions': lambda e: self._workspace_table_mundane_positions(),
			'antiscia': lambda e: self._workspace_table_antiscia(),
			'zodpars': lambda e: self._workspace_table_zodpars(),
			'strip': lambda e: self._workspace_table_strip(),
			'almuten_zodiacal': lambda e: self._workspace_table_almuten_zodiacal(),
			'almuten_chart': lambda e: self._workspace_table_almuten_chart(),
			'fixed_stars': lambda e: self._workspace_table_fixed_stars(),
			'fixed_stars_aspects': lambda e: self._workspace_table_fixed_stars_aspects(),
			'fixed_stars_parallels': lambda e: self._workspace_table_fixed_stars_parallels(),
			'eclipses': lambda e: self._workspace_table_eclipses(),
			'angle_at_birth': lambda e: self._workspace_table_angle_at_birth(),
			'circumambulation': lambda e: self._workspace_open_circumambulation(),
			'zodiacal_releasing': lambda e: self._workspace_table_zodiacal_releasing(),
			'decennials': lambda e: self._workspace_table_decennials(),
			'phasis': lambda e: self._workspace_table_phasis(),
			'paranatellonta': lambda e: self._workspace_table_paranatellonta(),
		}
		handler = action_map.get(action_id)
		if handler is not None:
			handler(None)

	def _handle_workspace_document_move(self, action, doc_id, before_id=None):
		if action == 'query_siblings':
			indices = self._workspace_state.sibling_list_indices(doc_id)
			return [self._workspace_state.documents()[i].document_id for i in indices]
		if action == 'move':
			if self._workspace_state.move_document(doc_id, before_id):
				self._refresh_workspace_navigation()

	def _handle_workspace_document(self, session_id):
		self._switch_workspace_session(session_id)

	def _workspace_open_transits_from_document(self, document_id):
		session = self._find_workspace_session(document_id)
		if session is None:
			return

		document = self._workspace_state.find_document(document_id)
		selected_indent = 0 if document is None else max(0, int(getattr(document, 'indent_level', 0) or 0))

		base_chart = session.get('chart')
		cs = session.get('chart_session')
		if cs is not None and cs.chart is not None:
			base_chart = cs.chart
		if base_chart is None:
			return

		runtime_radix = base_chart
		if cs is not None and cs.radix is not None:
			runtime_radix = cs.radix

		if runtime_radix.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		now = self._current_chart_datetime()
		place = base_chart.place
		time = chart.Time(
			now.year, now.month, now.day, now.hour, now.minute, now.second,
			False, base_chart.time.cal, base_chart.time.zt,
			base_chart.time.plus, base_chart.time.zh, base_chart.time.zm,
			False, place, False,
			tzid=getattr(base_chart.time, 'tzid', ''),
			tzauto=getattr(base_chart.time, 'tzauto', False)
		)
		trans = chart.Chart(base_chart.name, base_chart.male, time, place, chart.Chart.TRANSIT, '', self.options, False)
		label = self._workspace_timed_label(mtexts.typeList[chart.Chart.TRANSIT], time.year, time.month, time.day, time.hour, time.minute)
		self._open_workspace_session(
			trans, session_label=label,
			radix=base_chart, view_mode=chart_session.ChartSession.COMPOUND,
			navigation_units=('day', 'hour', 'minute'),
			navigation_title_label=mtexts.typeList[chart.Chart.TRANSIT],
			display_datetime=(time.year, time.month, time.day, time.hour, time.minute, time.second),
			parent_document_id_override=document_id,
			indent_level_override=(selected_indent + 1),
		)

	def _workspace_open_secondary_dirs_from_document(self, document_id):
		session = self._find_workspace_session(document_id)
		if session is None:
			return

		document = self._workspace_state.find_document(document_id)
		selected_indent = 0 if document is None else max(0, int(getattr(document, 'indent_level', 0) or 0))

		base_chart = session.get('chart')
		cs = session.get('chart_session')
		if cs is not None and cs.chart is not None:
			base_chart = cs.chart
		if base_chart is None:
			return

		runtime_radix = base_chart
		if cs is not None and cs.radix is not None:
			runtime_radix = cs.radix

		if runtime_radix.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		now = self._current_chart_datetime()
		age = symbolic_time.symbolic_age_for_real_datetime(base_chart, (now.year, now.month, now.day, now.hour, now.minute, now.second))
		direct = True
		sdir = secdir.SecDir(base_chart, age, direct, False)
		y, m, d, hour, minute, second = sdir.compute()
		place = base_chart.place
		time = chart.Time(y, m, d, hour, minute, second, False, base_chart.time.cal, chart.Time.LOCALMEAN, True, 0, 0, False, place, False)
		secdirchart = chart.Chart(base_chart.name, base_chart.male, time, place, chart.Chart.TRANSIT, '', self.options, False)
		label = self._workspace_timed_label('Sec. Progression', time.year, time.month, time.day, time.hour, time.minute)
		doc = self._open_workspace_session(
			secdirchart, session_label=label,
			radix=base_chart, view_mode=chart_session.ChartSession.CHART,
			display_datetime=self._secondary_display_datetime_for_chart(secdirchart, base_chart),
			parent_document_id_override=document_id,
			indent_level_override=(selected_indent + 1),
		)
		if doc is not None:
			active_cs = self._active_chart_session()
			if active_cs is not None:
				stepdlg = stepperdlg.StepperDlg(self, base_chart, age, direct, False, self.options, self.title, on_step=self._make_stepper_callback(active_cs))
				active_cs._stepper = stepdlg
				self.handleStatusBar(True)
				self.handleCaption(True)
				if ENABLE_SECONDARY_POPUP_STEPPER:
					stepdlg.CenterOnParent()
					stepdlg.Show(True)
				else:
					stepdlg.Show(False)

	def _workspace_parallel_transit_available(self, document_id):
		session = self._find_workspace_session(document_id)
		if session is None:
			return False
		cs = session.get('chart_session')
		if cs is None:
			return False
		radix = cs.radix if cs.radix is not None else cs.chart
		if radix is None:
			return False
		return not getattr(radix.time, 'bc', False)

	def _toggle_workspace_parallel_transits_for_document(self, document_id):
		session = self._find_workspace_session(document_id)
		if session is None:
			return
		session['parallel_transits_enabled'] = not session.get('parallel_transits_enabled', False)
		if self._workspace_state.active_document_id() == document_id:
			self.drawBkg()
			self.Refresh()

	def _handle_workspace_document_context(self, document_id, event=None):
		session = self._find_workspace_session(document_id)
		if session is None:
			return

		if self._workspace_state.active_document_id() != document_id:
			self._switch_workspace_session(document_id)

		menu = wx.Menu()
		item_transits = menu.Append(wx.ID_ANY, mtexts.typeList[chart.Chart.TRANSIT])
		item_secondary = menu.Append(wx.ID_ANY, mtexts.txts['SecondaryDir'])
		menu.Bind(wx.EVT_MENU, lambda evt, doc_id=document_id: self._workspace_open_transits_from_document(doc_id), item_transits)
		menu.Bind(wx.EVT_MENU, lambda evt, doc_id=document_id: self._workspace_open_secondary_dirs_from_document(doc_id), item_secondary)

		menu.AppendSeparator()
		item_parallel = menu.Append(wx.ID_ANY, u'Parallel Transit', '', wx.ITEM_CHECK)
		item_parallel.Enable(self._workspace_parallel_transit_available(document_id))
		if session.get('parallel_transits_enabled', False):
			item_parallel.Check(True)
		menu.Bind(wx.EVT_MENU, lambda evt, doc_id=document_id: self._toggle_workspace_parallel_transits_for_document(doc_id), item_parallel)

		windowbehavior.popup_menu(self, menu, event)
		menu.Destroy()

	def _handle_workspace_document_close(self, document_id):
		close_ids = self._collect_workspace_descendant_ids(document_id)
		close_ids.append(document_id)
		next_id = self._workspace_state.active_document_id()
		for close_id in reversed(close_ids):
			self._workspace_runtime.pop(close_id, None)
			next_id = self._workspace_state.close_document(close_id)
		if next_id is not None:
			self._activate_workspace_session(next_id)
		else:
			self.fpath = ''
			self.dirty = False
			self.splash = True
			self.enableMenus(False)
			self.closeChildWnds()
			self.drawSplash()
			self.handleStatusBar(False)
			self.handleCaption(False)
			self._refresh_workspace_navigation()
			self.Refresh()

	def _open_workspace_chart_path(self, path):
		if not path or not os.path.exists(path):
			return

		if self.dirty:
			dlgm = wx.MessageDialog(self, mtexts.txts['DiscardCurrHor'], mtexts.txts['Confirm'], wx.YES_NO|wx.ICON_QUESTION)
			if dlgm.ShowModal() == wx.ID_NO:
				dlgm.Destroy()
				return
			dlgm.Destroy()

		dname = os.path.dirname(path)
		chrt = self.subLoad(path, dname, True)
		if chrt != None:
			self._activate_loaded_chart(chrt, path, dname)

	def _get_configured_solar_return_year(self):
		now = datetime.datetime.now()
		natal_month = self.horoscope.time.month
		natal_day = self.horoscope.time.day

		active_year = now.year
		if (now.month, now.day) < (natal_month, natal_day):
			active_year -= 1

		if getattr(self.options, 'revolutions_solaryearmode', 0) == 1:
			return active_year + 1
		return active_year

	def _should_prompt_quickcharts(self):
		return getattr(self.options, 'quickcharts_prompt', True)

	def _active_radix_chart(self):
		cs = self._active_chart_session()
		if cs is not None and cs.radix is not None:
			return cs.radix
		return self.horoscope

	def _current_natal_place(self, radix_chart=None):
		radix = self._active_radix_chart() if radix_chart is None else radix_chart
		return radix.place

	def _chart_time_from_dialog(self, dlg, place, full=True):
		plus = dlg.pluscb.GetCurrentSelection() != 1
		tzauto = bool(
			hasattr(dlg, 'autotzckb')
			and dlg.zonecb.GetCurrentSelection() == chart.Time.ZONE
			and dlg.autotzckb.GetValue()
		)
		tzid = getattr(dlg, 'tzid', '')
		return chart.Time(
			int(dlg.year.GetValue()),
			int(dlg.month.GetValue()),
			int(dlg.day.GetValue()),
			int(dlg.hour.GetValue()),
			int(dlg.minute.GetValue()),
			int(dlg.sec.GetValue()),
			dlg.timeckb.GetValue(),
			dlg.calcb.GetCurrentSelection(),
			dlg.zonecb.GetCurrentSelection(),
			plus,
			int(dlg.zhour.GetValue()),
			int(dlg.zminute.GetValue()),
			dlg.daylightckb.GetValue(),
			place,
			full,
			tzid=tzid,
			tzauto=tzauto,
		)

	def _current_chart_datetime(self):
		return datetime.datetime.now()

	def _workspace_compact_datetime_text(self, y, m, d, h, mi):
		return '%04d.%02d.%02d %02d:%02d' % (
			int(y), int(m), int(d), int(h), int(mi),
		)

	def _workspace_timed_label(self, prefix, y, m, d, h, mi):
		return '%s (%s)' % (prefix, self._workspace_compact_datetime_text(y, m, d, h, mi))

	def _current_secondary_age(self, radix_chart=None):
		radix = self._active_radix_chart() if radix_chart is None else radix_chart
		now = self._current_chart_datetime()
		birth_tuple = (
			radix.time.origmonth,
			radix.time.origday,
			radix.time.hour,
			radix.time.minute,
			radix.time.second,
		)
		now_tuple = (now.month, now.day, now.hour, now.minute, now.second)
		age = now.year - radix.time.origyear
		if now_tuple < birth_tuple:
			age -= 1
		return max(0, age)

	def _open_current_transits(self):
		radix = self._active_radix_chart()
		now = self._current_chart_datetime()
		place = self._current_natal_place(radix)
		time = chart.Time(
			now.year, now.month, now.day, now.hour, now.minute, now.second,
			False, radix.time.cal, radix.time.zt,
			radix.time.plus, radix.time.zh, radix.time.zm,
			False, place, False,
			tzid=getattr(radix.time, 'tzid', ''),
			tzauto=getattr(radix.time, 'tzauto', False)
		)
		trans = chart.Chart(radix.name, radix.male, time, place, chart.Chart.TRANSIT, '', self.options, False)
		label = self._workspace_timed_label(mtexts.typeList[chart.Chart.TRANSIT], time.year, time.month, time.day, time.hour, time.minute)
		self._open_workspace_session(
			trans, session_label=label,
			radix=radix, view_mode=chart_session.ChartSession.COMPOUND,
			navigation_units=('day', 'hour', 'minute'),
			navigation_title_label=mtexts.typeList[chart.Chart.TRANSIT],
			display_datetime=(time.year, time.month, time.day, time.hour, time.minute, time.second),
		)

	def _open_current_secondary_dirs(self):
		radix = self._active_radix_chart()
		now = self._current_chart_datetime()
		age = symbolic_time.symbolic_age_for_real_datetime(radix, (now.year, now.month, now.day, now.hour, now.minute, now.second))
		direct = True
		sdir = secdir.SecDir(radix, age, direct, False)
		y, m, d, hour, minute, second = sdir.compute()
		place = self._current_natal_place(radix)
		time = chart.Time(y, m, d, hour, minute, second, False, radix.time.cal, chart.Time.LOCALMEAN, True, 0, 0, False, place, False)
		secdirchart = chart.Chart(radix.name, radix.male, time, place, chart.Chart.TRANSIT, '', self.options, False)
		label = self._workspace_timed_label('Sec. Progression', time.year, time.month, time.day, time.hour, time.minute)
		doc = self._open_workspace_session(
			secdirchart, session_label=label,
			radix=radix, view_mode=chart_session.ChartSession.CHART,
			display_datetime=self._secondary_display_datetime_for_chart(secdirchart, radix),
		)
		if doc is not None:
			cs = self._active_chart_session()
			if cs is not None:
				# Keep stepper object alive for keyboard stepping; only popup visibility is gated.
				stepdlg = stepperdlg.StepperDlg(self, radix, age, direct, False, self.options, self.title, on_step=self._make_stepper_callback(cs))
				cs._stepper = stepdlg
				self.handleStatusBar(True)
				self.handleCaption(True)
				if ENABLE_SECONDARY_POPUP_STEPPER:
					stepdlg.CenterOnParent()
					stepdlg.Show(True)
				else:
					stepdlg.Show(False)

	def _open_current_profections_chart(self):
		radix = self._active_radix_chart()
		now = self._current_chart_datetime()
		y = now.year
		m = now.month
		d = now.day
		h = now.hour
		mi = now.minute
		s = now.second
		proftype = chart.Chart.YEAR
		t = h+mi/60.0+s/3600.0

		if self.options.zodprof:
			prof = profections.Profections(radix, y, m, d, t)
			pchart = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PROFECTION, '', self.options, False, proftype)
			pchart.calcProfPos(prof)
		else:
			if not self.options.usezodprojsprof and (y == radix.time.year or (y-radix.time.year) % 12 == 0) and m == radix.time.month and d == radix.time.day:
				pchart = radix
			else:
				prof = munprofections.MunProfections(radix, y, m, d, t)
				proflondeg, proflonmin, proflonsec = util.decToDeg(prof.lonZ)
				profplace = chart.Place(mtexts.txts['Profections'], proflondeg, proflonmin, proflonsec, prof.east, radix.place.deglat, radix.place.minlat, radix.place.seclat, radix.place.north, radix.place.altitude)
				pchart = chart.Chart(radix.name, radix.male, radix.time, profplace, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
				pchartpls = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
				pchart.planets.calcMundaneProfPos(pchart.houses.ascmc2, pchartpls.planets.planets, radix.place.lat, radix.obl[0])
				pchart.fortune.calcMundaneProfPos(pchart.houses.ascmc2, pchartpls.fortune, radix.place.lat, radix.obl[0])
				pchart.calcAspMatrix()

		label = self._workspace_timed_label(mtexts.txts['Profections'], y, m, d, h, mi)
		doc = self._open_workspace_session(
			pchart, session_label=label,
			radix=radix, view_mode=chart_session.ChartSession.CHART,
			display_datetime=(y, m, d, h, mi, s),
		)
		if doc is not None:
			cs = self._active_chart_session()
			if cs is not None:
				pstepdlg = profectionstepperdlg.ProfectionStepperDlg(self, radix, y, m, d, t, self.options, self.title, on_step=self._make_stepper_callback(cs))
				cs._stepper = pstepdlg
				self.handleStatusBar(True)
				self.handleCaption(True)
				pstepdlg.CenterOnParent()
				pstepdlg.Show(True)

	def _build_revolution_place(self, dlg):
		direc = dlg.placerbE.GetValue()
		hemis = dlg.placerbN.GetValue()
		return chart.Place(
			dlg.birthplace.GetValue(),
			int(dlg.londeg.GetValue()),
			int(dlg.lonmin.GetValue()),
			0,
			direc,
			int(dlg.latdeg.GetValue()),
			int(dlg.latmin.GetValue()),
			0,
			hemis,
			0
		)

	def _create_revolution_frame(self, revtype, time, place):
		revolution = chart.Chart(self.horoscope.name, self.horoscope.male, time, place, revtype, '', self.options, False)
		title = self.title.replace(
			mtexts.typeList[self.horoscope.htype],
			mtexts.typeList[revtype]+' ('+str(time.year)+'.'+common.common.months[time.month-1]+'.'+str(time.day)+' '+str(time.hour)+':'+str(time.minute).zfill(2)+':'+str(time.second).zfill(2)+'('+mtexts.txts['GMT']+'))'
		)
		rw = transitframe.TransitFrame(self, title, revolution, self.horoscope, self.options)
		rw.Show(True)
		wx.CallAfter(rw.Raise)
		wx.CallAfter(rw.SetFocus)
		return rw

	def _install_solar_revolution_stepper(self, frame, place, plus, base_year):
		self._rev_frame = frame
		self._rev_ctx = {'place': place, 'plus': plus, 'revtype': chart.Chart.SOLAR}
		self._rev_year = int(base_year)

		try:
			if hasattr(self, "_rev_stepper") and self._rev_stepper:
				self._rev_stepper.Destroy()
				self._rev_stepper = None
		except Exception:
			pass

		def _on_close(evt):
			try:
				if hasattr(self, "_rev_stepper") and self._rev_stepper:
					self._rev_stepper.Destroy()
					self._rev_stepper = None
			except Exception:
				pass
			evt.Skip()

		self._rev_frame.Bind(wx.EVT_CLOSE, _on_close)

		def _set_rev_year_and_refresh(new_year):
			revs2 = revolutions.Revolutions()
			ok = revs2.compute(revolutions.Revolutions.SOLAR, int(new_year), self.horoscope.time.month, self.horoscope.time.day, self.horoscope)
			if not ok:
				return

			y, m, d, hh, mi, ss = revs2.t[0], revs2.t[1], revs2.t[2], revs2.t[3], revs2.t[4], revs2.t[5]
			try:
				if self.options.ayanamsha != 0:
					y, m, d, hh, mi, ss = self.calcPrecNutCorrectedRevolution(revs2, astrology.SE_SUN, topo_place=self._rev_ctx['place'])
			except Exception:
				pass

			time2 = chart.Time(y, m, d, hh, mi, ss, False, self.horoscope.time.cal, chart.Time.GREENWICH, self._rev_ctx['plus'], 0, 0, False, self._rev_ctx['place'], False)
			chart2 = chart.Chart(self.horoscope.name, self.horoscope.male, time2, self._rev_ctx['place'], self._rev_ctx['revtype'], '', self.options, False)
			newtitle2 = self.title.replace(
				mtexts.typeList[self.horoscope.htype],
				mtexts.typeList[self._rev_ctx['revtype']]+' ('+str(time2.year)+'.'+common.common.months[time2.month-1]+'.'+str(time2.day)+' '+str(time2.hour)+':'+str(time2.minute).zfill(2)+':'+str(time2.second).zfill(2)+'('+mtexts.txts['GMT']+'))'
			)

			try:
				self._rev_frame.change_chart(chart2)
				self._rev_frame.SetTitle(newtitle2)
				wx.CallAfter(self._rev_frame.Raise)
				wx.CallAfter(self._rev_frame.SetFocus)
			except Exception:
				try:
					self._rev_frame.Destroy()
				except Exception:
					pass
				self._rev_frame = transitframe.TransitFrame(self, newtitle2, chart2, self.horoscope, self.options)
				self._rev_frame.Show(True)
				wx.CallAfter(self._rev_frame.Raise)
				wx.CallAfter(self._rev_frame.SetFocus)
				self._rev_frame.Bind(wx.EVT_CLOSE, _on_close)

			self._rev_year = int(new_year)

		from revolutionsdlg import RevolutionYearStepper
		self._rev_stepper = RevolutionYearStepper(parent=self, get_year_cb=lambda: self._rev_year, set_year_cb=_set_rev_year_and_refresh)
		self._rev_frame._stepper = self._rev_stepper
		if ENABLE_SOLAR_REVOLUTION_POPUP_STEPPER:
			self._rev_stepper.Show(True)
			try:
				self._rev_stepper.CentreOnScreen()
			except Exception:
				self._rev_stepper.CenterOnScreen()
			self._rev_stepper.Raise()
		else:
			self._rev_stepper.Show(False)

	def _install_workspace_solar_revolution_stepper(self, place, plus, base_year):
		cs = self._active_chart_session()
		if cs is None:
			return
		rev_base = cs.radix if cs.radix is not None else self._active_radix_chart()
		self._rev_ctx = {'place': place, 'plus': plus, 'revtype': chart.Chart.SOLAR, 'radix': rev_base}
		self._rev_year = int(base_year)

		try:
			if hasattr(self, "_rev_stepper") and self._rev_stepper:
				self._rev_stepper.Destroy()
				self._rev_stepper = None
		except Exception:
			pass

		def _set_rev_year_and_refresh(new_year):
			active_cs = self._active_chart_session()
			if active_cs is None:
				return
			rev_base = self._rev_ctx.get('radix') or (active_cs.radix if active_cs.radix is not None else self._active_radix_chart())
			revs2 = revolutions.Revolutions()
			ok = revs2.compute(revolutions.Revolutions.SOLAR, int(new_year), rev_base.time.month, rev_base.time.day, rev_base)
			if not ok:
				return

			y, m, d, hh, mi, ss = revs2.t[0], revs2.t[1], revs2.t[2], revs2.t[3], revs2.t[4], revs2.t[5]
			try:
				if self.options.ayanamsha != 0:
					y, m, d, hh, mi, ss = self.calcPrecNutCorrectedRevolution(revs2, astrology.SE_SUN, topo_place=self._rev_ctx['place'])
			except Exception:
				pass

			time2 = chart.Time(y, m, d, hh, mi, ss, False, rev_base.time.cal, chart.Time.GREENWICH, self._rev_ctx['plus'], 0, 0, False, self._rev_ctx['place'], False)
			chart2 = chart.Chart(rev_base.name, rev_base.male, time2, self._rev_ctx['place'], self._rev_ctx['revtype'], '', self.options, False)
			active_cs.change_chart(chart2, display_datetime=(time2.year, time2.month, time2.day, time2.hour, time2.minute, time2.second))
			self._rev_year = int(new_year)

		from revolutionsdlg import RevolutionYearStepper
		self._rev_stepper = RevolutionYearStepper(parent=self, get_year_cb=lambda: self._rev_year, set_year_cb=_set_rev_year_and_refresh)
		cs._stepper = self._rev_stepper
		self.handleStatusBar(True)
		self.handleCaption(True)
		if ENABLE_SOLAR_REVOLUTION_POPUP_STEPPER:
			self._rev_stepper.Show(True)
			try:
				self._rev_stepper.CentreOnScreen()
			except Exception:
				self._rev_stepper.CenterOnScreen()
			self._rev_stepper.Raise()
		else:
			self._rev_stepper.Show(False)

	def _open_configured_solar_revolution(self):
		radix = self._active_radix_chart()
		revs = revolutions.Revolutions()
		target_year = self._get_configured_solar_return_year()
		ok = revs.compute(revolutions.Revolutions.SOLAR, target_year, radix.time.month, radix.time.day, radix)
		if not ok:
			dlgm = wx.MessageDialog(self, mtexts.txts['CouldnotComputeRevolution'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		t1, t2, t3, t4, t5, t6 = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]
		if self.options.ayanamsha != 0:
			try:
				t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, astrology.SE_SUN)
			except Exception:
				pass

		ti = (t1, t2, t3, t4, t5, t6, chart.Time.GREGORIAN, chart.Time.GREENWICH, 0, 0)
		place = radix.place
		plus = True

		if getattr(self.options, 'revolutions_solarlocationmode', 0) == 1:
			dlg = timespacedlg.TimeSpaceDlg(self, mtexts.txts['Revolutions'], self.options.langid)
			dlg.initialize(radix, ti)
			dlg.CenterOnParent()
			if dlg.ShowModal() != wx.ID_OK:
				dlg.Destroy()
				return
			place = self._build_revolution_place(dlg)
			if self.options.ayanamsha != 0:
				try:
					t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, astrology.SE_SUN, topo_place=place, seed=(t1, t2, t3, t4, t5, t6))
				except Exception:
					pass
			if dlg.pluscb.GetCurrentSelection() == 1:
				plus = False
			dlg.Destroy()
		else:
			if self.options.ayanamsha != 0:
				try:
					t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, astrology.SE_SUN, topo_place=place, seed=(t1, t2, t3, t4, t5, t6))
				except Exception:
					pass

		time = chart.Time(t1, t2, t3, t4, t5, t6, False, radix.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)
		revolution = chart.Chart(radix.name, radix.male, time, place, chart.Chart.SOLAR, '', self.options, False)
		label = self._workspace_timed_label(mtexts.typeList[chart.Chart.SOLAR], time.year, time.month, time.day, time.hour, time.minute)
		doc = self._open_workspace_session(
			revolution, session_label=label,
			radix=radix, view_mode=chart_session.ChartSession.CHART,
			display_datetime=(time.year, time.month, time.day, time.hour, time.minute, time.second),
		)
		if doc is not None:
			self._install_workspace_solar_revolution_stepper(place, plus, t1)

	def _open_quick_lunar_revolution(self):
		"""Compute and open the current lunar revolution (not the next one)."""
		radix = self._active_radix_chart()
		
		# Find the lunar return we're currently in (not the next one)
		now = datetime.datetime.now()
		revs = revolutions.Revolutions()
		
		# Compute lunar revolution from today onwards
		ok = revs.compute(revolutions.Revolutions.LUNAR, now.year, now.month, now.day, radix)
		if not ok:
			dlgm = wx.MessageDialog(self, mtexts.txts['CouldnotComputeRevolution'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		t1, t2, t3, t4, t5, t6 = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]
		
		# Check if computed return is in the future; if so, get the previous lunar return (current period)
		try:
			return_dt = datetime.datetime(int(t1), int(t2), int(t3), int(t4), int(t5), int(t6))
			if return_dt > now:
				# Go back one month and compute the previous lunar return
				prev_year, prev_month = int(now.year), int(now.month) - 1
				if prev_month < 1:
					prev_month = 12
					prev_year -= 1
				revs_prev = revolutions.Revolutions()
				ok_prev = revs_prev.compute(revolutions.Revolutions.LUNAR, prev_year, prev_month, 1, radix)
				if ok_prev:
					revs = revs_prev
					t1, t2, t3, t4, t5, t6 = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]
		except Exception:
			pass
		
		if self.options.ayanamsha != 0:
			try:
				t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, astrology.SE_MOON)
			except Exception:
				pass

		place = radix.place
		plus = True
		if getattr(self.options, 'revolutions_lunarlocationmode', 0) == 1:
			ti = (t1, t2, t3, t4, t5, t6, chart.Time.GREGORIAN, chart.Time.GREENWICH, 0, 0)
			dlg = timespacedlg.TimeSpaceDlg(self, mtexts.txts['Revolutions'], self.options.langid)
			dlg.initialize(radix, ti)
			dlg.CenterOnParent()
			if dlg.ShowModal() != wx.ID_OK:
				dlg.Destroy()
				return
			direc = dlg.placerbE.GetValue()
			hemis = dlg.placerbN.GetValue()
			place = chart.Place(dlg.birthplace.GetValue(), int(dlg.londeg.GetValue()), int(dlg.lonmin.GetValue()), 0, direc, int(dlg.latdeg.GetValue()), int(dlg.latmin.GetValue()), 0, hemis, 0)
			if dlg.pluscb.GetCurrentSelection() == 1:
				plus = False
			dlg.Destroy()

		if self.options.ayanamsha != 0:
			try:
				t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, astrology.SE_MOON, topo_place=place, seed=(t1, t2, t3, t4, t5, t6))
			except Exception:
				pass

		time = chart.Time(t1, t2, t3, t4, t5, t6, False, radix.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)
		revolution = chart.Chart(radix.name, radix.male, time, place, chart.Chart.LUNAR, '', self.options, False)
		label = self._workspace_timed_label(mtexts.typeList[chart.Chart.LUNAR], time.year, time.month, time.day, time.hour, time.minute)
		doc = self._open_workspace_session(
			revolution, session_label=label,
			radix=radix, view_mode=chart_session.ChartSession.CHART,
			display_datetime=(time.year, time.month, time.day, time.hour, time.minute, time.second),
		)
		if doc is not None:
			# Attach lunar stepper for arrow key stepping
			self._rev_ctx = {'place': place, 'plus': plus, 'revtype': chart.Chart.LUNAR}
			self._lr_year = int(time.year)
			self._lr_month = int(time.month)
			self._lr_day = int(time.day)

			def _set_lr_ym_and_refresh(yy, mm):
				revs2 = revolutions.Revolutions()
				dd = int(self._lr_day)
				try:
					while not util.checkDate(int(yy), int(mm), int(dd)) and dd > 1:
						dd -= 1
				except Exception:
					pass
				result = revs2.compute(revolutions.Revolutions.LUNAR, int(yy), int(mm), int(dd), radix)
				if result:
					t1, t2, t3, t4, t5, t6 = revs2.t[0], revs2.t[1], revs2.t[2], revs2.t[3], revs2.t[4], revs2.t[5]
					if self.options.ayanamsha != 0:
						try:
							t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs2, astrology.SE_MOON, topo_place=place, seed=(t1, t2, t3, t4, t5, t6))
						except Exception:
							pass
					time2 = chart.Time(t1, t2, t3, t4, t5, t6, False, radix.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)
					chart2 = chart.Chart(radix.name, radix.male, time2, place, chart.Chart.LUNAR, '', self.options, False)
					active_cs = self._active_chart_session()
					if active_cs is not None:
						active_cs.change_chart(chart2, display_datetime=(time2.year, time2.month, time2.day, time2.hour, time2.minute, time2.second))
						return
					try:
						if hasattr(self, '_rev_frame') and self._rev_frame is not None:
							self._rev_frame.change_chart(chart2)
							self._rev_frame.SetTitle(self._workspace_timed_label(mtexts.typeList[chart.Chart.LUNAR], time2.year, time2.month, time2.day, time2.hour, time2.minute))
					except Exception:
						pass

			def _get_lr_ym():
				return (self._lr_year, self._lr_month)

			def _set_lr_ym(yy, mm):
				self._lr_year, self._lr_month = int(yy), int(mm)
				_set_lr_ym_and_refresh(self._lr_year, self._lr_month)

			from revolutionsdlg import RevolutionMonthStepper
			self._rev_stepper = RevolutionMonthStepper(
				parent=self,
				get_ym_cb=_get_lr_ym,
				set_ym_cb=_set_lr_ym,
			)
			cs = self._active_chart_session()
			if cs is not None:
				cs._stepper = self._rev_stepper
			self.handleStatusBar(True)
			self.handleCaption(True)
			if ENABLE_LUNAR_POPUP_STEPPER:
				self._rev_stepper.Show(True)
				try:
					self._rev_stepper.CentreOnScreen()
				except Exception:
					self._rev_stepper.CenterOnScreen()
				self._rev_stepper.Raise()
			else:
				self._rev_stepper.Show(False)

	def _open_quick_planet_revolution(self, planet_type):
		"""Open a planetary revolution (Mercury–Saturn) for the next return from today."""
		if self.splash or self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		radix = self._active_radix_chart()

		_pid_map = {
			revolutions.Revolutions.MERCURY: astrology.SE_MERCURY,
			revolutions.Revolutions.VENUS:   astrology.SE_VENUS,
			revolutions.Revolutions.MARS:    astrology.SE_MARS,
			revolutions.Revolutions.JUPITER: astrology.SE_JUPITER,
			revolutions.Revolutions.SATURN:  astrology.SE_SATURN,
		}
		_lookback_map = {
			revolutions.Revolutions.MERCURY: 4,
			revolutions.Revolutions.VENUS:   9,
			revolutions.Revolutions.MARS:    25,
			revolutions.Revolutions.JUPITER: 144,
			revolutions.Revolutions.SATURN:  355,
		}
		pid      = _pid_map.get(planet_type)
		_lookback = _lookback_map.get(planet_type, 4)

		now = datetime.datetime.now()
		wx.BeginBusyCursor()
		try:
			revs = revolutions.Revolutions()
			ok = revs.compute(planet_type, now.year, now.month, now.day, radix)
		finally:
			if wx.IsBusy():
				wx.EndBusyCursor()

		if not ok:
			dlgm = wx.MessageDialog(self, mtexts.txts['CouldnotComputeRevolution'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		t1, t2, t3, t4, t5, t6 = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]
		if self.options.ayanamsha != 0 and pid is not None:
			try:
				t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, pid)
			except Exception:
				pass

		place = radix.place
		plus  = True
		if getattr(self.options, 'revolutions_planetslocationmode', 0) == 1:
			ti  = (t1, t2, t3, t4, t5, t6, chart.Time.GREGORIAN, chart.Time.GREENWICH, 0, 0)
			dlg = timespacedlg.TimeSpaceDlg(self, mtexts.txts['Revolutions'], self.options.langid)
			dlg.initialize(radix, ti)
			dlg.CenterOnParent()
			if dlg.ShowModal() != wx.ID_OK:
				dlg.Destroy()
				return
			direc = dlg.placerbE.GetValue()
			hemis = dlg.placerbN.GetValue()
			place = chart.Place(dlg.birthplace.GetValue(), int(dlg.londeg.GetValue()), int(dlg.lonmin.GetValue()), 0, direc, int(dlg.latdeg.GetValue()), int(dlg.latmin.GetValue()), 0, hemis, 0)
			if dlg.pluscb.GetCurrentSelection() == 1:
				plus = False
			dlg.Destroy()
		if self.options.ayanamsha != 0 and pid is not None:
			try:
				t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, pid, topo_place=place, seed=(t1, t2, t3, t4, t5, t6))
			except Exception:
				pass

		time = chart.Time(t1, t2, t3, t4, t5, t6, False, radix.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)
		revolution = chart.Chart(radix.name, radix.male, time, place, chart.Chart.REVOLUTION, '', self.options, False)
		label = self._workspace_timed_label(mtexts.revtypeList[planet_type], time.year, time.month, time.day, time.hour, time.minute)
		doc = self._open_workspace_session(
			revolution, session_label=label,
			radix=radix, view_mode=chart_session.ChartSession.CHART,
			display_datetime=(time.year, time.month, time.day, time.hour, time.minute, time.second),
		)
		if doc is None:
			return

		self._rev_ctx = {'place': place, 'plus': plus, 'revtype': chart.Chart.REVOLUTION}
		self._planet_rev_seed = (int(t1), int(t2), int(t3))
		try:
			if hasattr(self, '_rev_stepper') and self._rev_stepper:
				self._rev_stepper.Destroy()
				self._rev_stepper = None
		except Exception:
			pass

		def _set_planet_rev_and_refresh(sy, sm, sd):
			revs2 = revolutions.Revolutions()
			ok2 = revs2.compute(planet_type, int(sy), int(sm), int(sd), radix)
			if not ok2:
				return
			ry = revs2.t[0]; rm = revs2.t[1]; rd = revs2.t[2]
			rhh = revs2.t[3]; rmi = revs2.t[4]; rss = revs2.t[5]
			try:
				if self.options.ayanamsha != 0 and pid is not None:
					ry, rm, rd, rhh, rmi, rss = self.calcPrecNutCorrectedRevolution(
						revs2, pid, topo_place=self._rev_ctx['place'])
			except Exception:
				pass
			time2 = chart.Time(int(ry), int(rm), int(rd), int(rhh), int(rmi), int(rss),
							   False, radix.time.cal, chart.Time.GREENWICH,
							   self._rev_ctx['plus'], 0, 0, False, self._rev_ctx['place'], False)
			chart2 = chart.Chart(radix.name, radix.male, time2,
								 self._rev_ctx['place'], self._rev_ctx['revtype'], '', self.options, False)
			self._planet_rev_seed = (int(ry), int(rm), int(rd))
			active_cs = self._active_chart_session()
			if active_cs is not None:
				active_cs.change_chart(chart2, display_datetime=(time2.year, time2.month, time2.day, time2.hour, time2.minute, time2.second))

		def _step_planet_forward():
			import datetime as _dt
			prev_seed = self._planet_rev_seed
			sy, sm, sd = prev_seed
			for attempt in range(10):
				try:
					nxt = _dt.date(int(sy), int(sm), int(sd)) + _dt.timedelta(days=1 + attempt)
					_set_planet_rev_and_refresh(nxt.year, nxt.month, nxt.day)
				except Exception:
					pass
				if self._planet_rev_seed != prev_seed:
					break

		def _step_planet_backward():
			prev_seed = self._planet_rev_seed
			sy, sm, sd = prev_seed
			for attempt in range(10):
				bm = sm - _lookback - attempt
				by = sy
				while bm < 1:
					bm += 12
					by -= 1
				_set_planet_rev_and_refresh(by, bm, 1)
				if self._planet_rev_seed != prev_seed:
					break

		from revolutionsdlg import RevolutionCallbackStepperController
		self._rev_stepper = RevolutionCallbackStepperController(
			step_backward_cb=_step_planet_backward,
			step_forward_cb=_step_planet_forward,
		)
		cs = self._active_chart_session()
		if cs is not None:
			cs._stepper = self._rev_stepper
		self.handleStatusBar(True)
		self.handleCaption(True)

	def _activate_loaded_chart(self, chrt, fpath, dpath):
		self._open_workspace_session(chrt, fpath=fpath, dpath=dpath, add_to_history=True)

	def _load_startup_chart_if_configured(self):
		startup_path = getattr(self.options, 'startupchart', '')
		if not startup_path:
			return
		if not os.path.exists(startup_path):
			self.options.startupchart = ''
			try:
				self.options.saveStartupChart()
			except Exception:
				pass
			return
		dpath = os.path.dirname(startup_path)
		chrt = self.subLoad(startup_path, dpath, True)
		if chrt is not None:
			self._activate_loaded_chart(chrt, startup_path, dpath)

	def onQuickSolarRevolution(self, event=None):
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.splash or self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		wx.BeginBusyCursor()
		try:
			try:
				self._open_configured_solar_revolution()
			except Exception:
				import traceback
				traceback.print_exc()
				dlgm = wx.MessageDialog(self, 'Solar Revolution failed. Details were written to morinus.log.', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
				dlgm.ShowModal()
				dlgm.Destroy()
		finally:
			if wx.IsBusy():
				wx.EndBusyCursor()

	def onQuickLunarRevolution(self, event=None):
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.splash or self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		wx.BeginBusyCursor()
		try:
			try:
				self._open_quick_lunar_revolution()
			except Exception:
				import traceback
				traceback.print_exc()
				dlgm = wx.MessageDialog(self, 'Lunar Revolution failed. Details were written to morinus.log.', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
				dlgm.ShowModal()
				dlgm.Destroy()
		finally:
			if wx.IsBusy():
				wx.EndBusyCursor()

	def onCloseWindowShortcut(self, event):
		self.Close()

	def _close_non_main_frames(self):
		import wx
		# 메인 프레임(self)을 제외한 모든 TopLevel Frame을 닫는다.
		for w in wx.GetTopLevelWindows():
			try:
				# 메인 프레임은 제외
				if w is self:
					continue
				# Options 같은 wx.Dialog는 건드리지 않고,
				# 보조 차트 창(대부분 wx.Frame 파생)을 닫는다.
				if isinstance(w, wx.Frame) and not isinstance(w, wx.Dialog):
					# True로 강제 종료해 누수 방지
					w.Close(True)
			except Exception:
				# 개별 창에서 에러 나도 전체 동작은 유지
				pass

	def __init__(self, parent, id, title, opts):
# ###########################################
# Roberto Size changed  V 7.X.X
		wx.Frame.__init__(self, parent, id, title, wx.DefaultPosition, wx.Size(1064, 800))
# ###########################################
		wxcompat.apply_frame_screen_size(
			self,
			0.80,
			(1064, 800),
			min_size=(900, 676),
			width_cap_ratio=0.98,
			square=False,
		)
		try:
			self.SetWindowStyle(self.GetWindowStyle() | wx.WANTS_CHARS)
		except Exception:
			pass
		face = {6: 'Noto Sans SC', 7: 'Noto Sans TC', 8: 'Noto Sans KR'}.get(opts.langid, 'FreeSans')
		self.SetFont(wx.Font(9, wx.FONTFAMILY_DEFAULT, wx.FONTSTYLE_NORMAL, wx.FONTWEIGHT_NORMAL, False, face))

		# Ensure early paint events never crash (macOS can deliver EVT_PAINT while
		# the frame is still constructing).
		self.buffer = wx.Bitmap(1, 1)

		self.fpath = ''
		self.fpathhors = _morinus_user_hors_dir()
		self.fpathimgs = _morinus_user_images_dir()
		self._recent_hors_paths = []
		self._workspace_state = workspace_model.WorkspaceState()
		self._workspace_runtime = {}
		_copy_missing_tree(os.path.join(_BASE_DIR, 'Hors'), self.fpathhors)
		self.title = title
		self.origtitle = title
		self.hortitle = title
		self.ID_NatalSecondaryCycle = 6100
		self.ID_RadixOverlayNone = 6101
		self.ID_RadixOverlayFixStars = 6102
		self.ID_RadixOverlayDodecatemoria = 6103
		self.ID_RadixOverlayAntiscia = 6104
		self.ID_RadixOverlayContraAntiscia = 6105
		self.ID_RadixOverlayArabicParts = 6106
		self.ID_RadixTogglePlanetaryHour = 6107
		self.ID_RadixToggleHousesystem = 6108
		self.ID_RadixToggleInformation = 6109
		self._radix_overlay_menu_specs = (
			(self.ID_RadixOverlayNone, 'Simple Chart', options.Options.NONE),
			(self.ID_RadixOverlayDodecatemoria, 'Dodecatemoria', options.Options.DODECATEMORIA),
			(self.ID_RadixOverlayArabicParts, 'Arabic parts', options.Options.ARABICPARTS),
			(self.ID_RadixOverlayAntiscia, 'Antiscia', options.Options.ANTIS),
			(self.ID_RadixOverlayContraAntiscia, 'Contra-antiscia', options.Options.CANTIS),
			(self.ID_RadixOverlayFixStars, 'Fixed stars', options.Options.FIXSTARS),
		)
		self._radix_overlay_mode_by_id = {item_id: mode for item_id, _label, mode in self._radix_overlay_menu_specs}
		self._radix_display_toggle_by_id = {
			self.ID_RadixTogglePlanetaryHour: ('planetarydayhour', 'Planetary hour'),
			self.ID_RadixToggleHousesystem: ('housesystem', 'House system label'),
			self.ID_RadixToggleInformation: ('information', 'Chart information'),
		}
		
		self.options = opts
		import importlib
		importlib.reload(mtexts)  # 저장된 mtexts.py 변경분까지 즉시 재적재
		mtexts.setLang(self.options.langid)

		# wx 표준 라벨(파일 대화상자 버튼, About 등)도 새 로케일로 갱신
		self._locale = wx.Locale(LANG_MAP.get(self.options.langid, wx.LANGUAGE_ENGLISH))
		try:
			self._locale.AddCatalog("wxstd")
			self._locale.AddCatalog("wx")
		except Exception:
			pass

		# 선택된 언어로 wx 로케일 고정 (About 라벨 등 표준 문자열이 번역됨)
		self._locale = wx.Locale(LANG_MAP.get(opts.langid, wx.LANGUAGE_ENGLISH))
		try:
			# 표준 카탈로그(라벨 번역) 로드 시도
			self._locale.AddCatalog("wxstd")
			self._locale.AddCatalog("wx")
		except Exception:
			pass
		common.common = common.Common()
		common.common.update(self.options)

		self.CenterOnScreen()
		self.SetBackgroundColour(self.options.clrbackground)
		self.splash = True

		self.dirty = False

		menubar = wx.MenuBar()
		self.mhoros = wx.Menu()
		self.mtable = wx.Menu()
		self.moptions = wx.Menu()
		self.mcharts = wx.Menu()
		self.mhelp = wx.Menu()

		self.menubar = menubar

		#Horoscope-menu
# ###########################################
# Roberto change  V 7.2.0 # Elias v 8.0.0 add Dodecatemoria
		self.ID_New, self.ID_Data, self.ID_HereAndNow, self.ID_Load, self.ID_Save, self.ID_SaveAsBitmap, self.ID_Synastry, self.ID_FindTime, self.ID_Ephemeris, self.ID_Close, self.ID_Exit = range(100, 111)
# ###########################################

		#Table-menu
# ###########################################
# Roberto change  V 7.3.0 + V 8.0.1		
		(self.ID_Positions, self.ID_TAlmutens, self.ID_AlmutenZodiacal, self.ID_AlmutenChart, self.ID_AlmutenTopical, self.ID_Misc, self.ID_MunPos, 
		self.ID_Antiscia, self.ID_Aspects, self.ID_Midpoints, self.ID_RiseSet, self.ID_Speeds, self.ID_ZodPars, self.ID_FixStars, self.ID_FixStarsAsps, 
		self.ID_Arabians, self.ID_Strip, self.ID_PlanetaryHours, self.ID_ExactTransits, self.ID_Profections, self.ID_CustomerSpeculum, self.ID_Firdaria, self.ID_Dodecatemoria,self.ID_PrimaryDirs , self.ID_AngleAtBirth) = range(111,136)
		self.ID_ZodiacalReleasing = 136
		self.ID_Phasis = 137
		self.ID_Paranatellonta = 138
		self.ID_Circumambulation = 139
		self.ID_Eclipses = 186
		self.ID_Decennials = 187
		self.ID_FixStarAngleDirs = 185  # Angular directions of fixed stars
		self.ID_FixStarsParallels = 188
		self.ID_SearchModule = 189
		#Charts-menu
		self.ID_Transits, self.ID_Revolutions, self.ID_SunTransits, self.ID_SecondaryDirs, self.ID_Elections, self.ID_SquareChart, self.ID_ProfectionsChart, self.ID_MundaneChart = range(140, 148)
		self.ID_SecProgMenu = 5000  # Secondary progressions (submenu header)
		# --- new submenu headers ---
		self.ID_PlanetsPointsMenu = 5001
		self.ID_FixedStarsMenu   = 5002
		self.ID_TimeLordsMenu    = 5003
		self.ID_PrimaryDirsMenu  = 5004
		self.ID_TransitsMenu     = 5005
		self.ID_ChartsMenu      = 5016
		# --- Options submenu headers ---
		# --- New submenu headers ---
		self.ID_SaveMenu            = 5006  # Horoscope > Save group
		self.ID_ArabicPartsOptMenu  = 5011  # Options > ArabicParts (Fortuna+Arabic Parts)
		self.ID_PrimaryDirsOptMenu  = 5012  # Options > PrimaryDirs (Dirs+Keys+PDs in Chart)
		self.ID_TimeLordsOptMenu    = 5013  # Options > TimeLords (Profections+Firdaria)
		self.ID_AppearanceOptMenu   = 5014  # Options > Appearance1 (Appearance1/2+Colors+Symbols)
		self.ID_DignitiesOptMenu    = 5015  # Options > Dignities (Dignities+Minor Dignities)
		self.ID_PlanetsPointsOptMenu    = 5017  # Options > Planets/Points
		# Secondary progressions (Charts submenu)
		self.ID_SecProgChart = 148
		self.ID_SecProgPositions = 149

		#Options-menu
# ###########################################
# Roberto change  V 7.2.0
		(self.ID_Appearance1, self.ID_Appearance2, self.ID_Symbols, self.ID_Dignities, self.ID_MinorDignities, self.ID_Triplicities, self.ID_Terms,
		self.ID_Decans, self.ID_Almutens, self.ID_ChartAlmuten, self.ID_Topical, self.ID_Colors, self.ID_Ayanamsha, self.ID_HouseSystem,
		self.ID_Nodes, self.ID_Orbs, self.ID_PrimaryDirsOpt, self.ID_PrimaryKeys, self.ID_PDsInChartOpt, self.ID_PDsInChartOptZod, self.ID_PDsInChartOptMun, self.ID_LotOfFortune, self.ID_ArabicParts, self.ID_Syzygy, self.ID_FixStarsOpt, self.ID_ProfectionsOpt, self.ID_FirdariaOpt, self.ID_DefLocationOpt, self.ID_Languages, self.ID_AutoSaveOpts, self.ID_SaveOpts, self.ID_Reload) = range(151, 183)
		self.ID_RevolutionsOpt = 1830
		self.ID_OtherRevolutions = 1831
		self.ID_LunarRevolution = 1832
		self.ID_QuickChartsOpt = 1833
		self.ID_SetStartupChart = 1834
		self.ID_ClearStartupChart = 1835
		self.ID_StepAlertsOpt = 1836
		self.ID_Rev_Mercury = 1837
		self.ID_Rev_Venus   = 1838
		self.ID_Rev_Mars    = 1839
		self.ID_Rev_Jupiter = 1840
		self.ID_Rev_Saturn  = 1841
# ###########################################

		self.ID_Housesystem1, self.ID_Housesystem2, self.ID_Housesystem3, self.ID_Housesystem4, self.ID_Housesystem5, self.ID_Housesystem6, self.ID_Housesystem7, self.ID_Housesystem8, self.ID_Housesystem9, self.ID_Housesystem10, self.ID_Housesystem11, self.ID_Housesystem12, self.ID_Housesystem13 = range(1050, 1063)

		self.ID_NodeMean = 1070
		self.ID_NodeTrue = 1071

		self.hsbase = 1050
		self.nodebase = 1070
# ###########################################
# Roberto change  V 7.2.0 /  V 7.3.0
		#Help-menu
		self.ID_Help = 183
		self.ID_About = 184
# ###########################################

		#Horoscope-menu
		self.mhoros.Append(self.ID_New, mtexts.menutxts['HMNew'], mtexts.menutxts['HMNewDoc'])
		self.mhoros.Append(self.ID_Data, mtexts.menutxts['HMData'], mtexts.menutxts['HMDataDoc'])
# ###########################################
# Roberto change  V 7.2.0		
		self.mhoros.Append(self.ID_HereAndNow, mtexts.menutxts['HMHereAndNow'], mtexts.menutxts['HMHereAndNowDoc'])
# ###########################################
		self.mhoros.Append(self.ID_Load, mtexts.menutxts['HMLoad'], mtexts.menutxts['HMLoadDoc'])
		# Save group
		self.hsave = wx.Menu()
		self.hsave.Append(self.ID_Save,          mtexts.menutxts['HMSave'],       mtexts.menutxts['HMSaveDoc'])
		self.hsave.Append(self.ID_SaveAsBitmap,  mtexts.menutxts['HMSaveAsBmp'],  mtexts.menutxts['HMSaveAsBmpDoc'])
		self.mhoros.Append(self.ID_SaveMenu, mtexts.txts['Save'], self.hsave)
		self.mhoros.Append(self.ID_SetStartupChart, 'Use Current As Startup Chart', 'Load the current chart automatically at startup')
		self.mhoros.Append(self.ID_ClearStartupChart, 'Clear Startup Chart', 'Clear the automatic startup chart')

		self.mhoros.Append(self.ID_Synastry, mtexts.menutxts['HMSynastry'], mtexts.menutxts['HMSynastryDoc'])
		self.mhoros.Append(self.ID_FindTime, mtexts.menutxts['HMFindTime'], mtexts.menutxts['HMFindTimeDoc'])
		self.mhoros.Append(self.ID_Ephemeris, mtexts.menutxts['HMEphemeris'], mtexts.menutxts['HMEphemerisDoc'])
		self.mhoros.AppendSeparator()
		self.mhoros.Append(self.ID_Close, mtexts.menutxts['HMClose'], mtexts.menutxts['HMCloseDoc'])
		self.mhoros.AppendSeparator()
		self.mhoros.Append(self.ID_Exit, mtexts.menutxts['HMExit'], mtexts.menutxts['HMExitDoc'])

		self.filehistory = wx.FileHistory()
		self.filehistory.UseMenu(self.mhoros)
		self.Bind(wx.EVT_MENU_RANGE, self.OnFileHistory, id=wx.ID_FILE1, id2=wx.ID_FILE9)

		#Table-menu
		# ---------------- Tables (grouped) ----------------

		# Planets/Points
		self.tplanets = wx.Menu()
		self.tplanets.Append(self.ID_Positions,        mtexts.menutxts['TMPositions'],        mtexts.menutxts['TMPositionsDoc'])   
		self.tplanets.Append(self.ID_Antiscia,         mtexts.menutxts['TMAntiscia'],         mtexts.menutxts['TMAntisciaDoc'])        
		self.tplanets.Append(self.ID_Dodecatemoria,    mtexts.menutxts['TMDodecatemoria'],    mtexts.menutxts['TMDodecatemoriaDoc'])
		self.tplanets.Append(self.ID_Strip,            mtexts.menutxts['TMStrip'],            mtexts.menutxts['TMStripDoc'])   
		self.tplanets.Append(self.ID_Aspects,          mtexts.menutxts['TMAspects'],          mtexts.menutxts['TMAspectsDoc']) 
		self.tplanets.Append(self.ID_ZodPars,          mtexts.menutxts['TMZodPars'],          mtexts.menutxts['TMZodParsDoc'])
		self.tplanets.Append(self.ID_Speeds,           mtexts.menutxts['TMSpeeds'],           mtexts.menutxts['TMSpeedsDoc'])
		self.tplanets.Append(self.ID_RiseSet,          mtexts.menutxts['TMRiseSet'],          mtexts.menutxts['TMRiseSetDoc'])     
		self.tplanets.Append(self.ID_PlanetaryHours,   mtexts.menutxts['TMPlanetaryHours'],   mtexts.menutxts['TMPlanetaryHoursDoc'])
		self.tplanets.Append(self.ID_Phasis,           mtexts.menutxts['TMPhasis'],           mtexts.menutxts['TMPhasisDoc'])     
		self.tplanets.Append(self.ID_Midpoints,        mtexts.menutxts['TMMidpoints'],        mtexts.menutxts['TMMidpointsDoc'])
		self.tplanets.Append(self.ID_Arabians,         mtexts.menutxts['TMArabianParts'],     mtexts.menutxts['TMArabianPartsDoc'])
		self.tplanets.Append(self.ID_Eclipses,         mtexts.menutxts['TMEclipses'],         mtexts.menutxts['TMEclipsesDoc'])
		self.tplanets.Append(self.ID_Misc,             mtexts.menutxts['TMMisc'],             mtexts.menutxts['TMMiscDoc'])
		self.mtable.Append(self.ID_PlanetsPointsMenu, mtexts.txts['PlanetsPoints'], self.tplanets)

		# Almutens (existing submenu)
		self.talmutens = wx.Menu()
		self.talmutens.Append(self.ID_AlmutenChart,    mtexts.menutxts['TMAlmutenChart'],    mtexts.menutxts['TMAlmutenChartDoc'])
		self.talmutens.Append(self.ID_AlmutenZodiacal, mtexts.menutxts['TMAlmutenZodiacal'], mtexts.menutxts['TMAlmutenZodiacalDoc'])
		
		self.talmutens.Append(self.ID_AlmutenTopical,  mtexts.menutxts['TMAlmutenTopical'],  mtexts.menutxts['TMAlmutenTopicalDoc'])
		self.mtable.Append(self.ID_TAlmutens, mtexts.menutxts['TMAlmutens'], self.talmutens)
		# (Almutens 서브메뉴가 이미 존재하는 형태는 파일에 보임) :contentReference[oaicite:4]{index=4}

		# Fixed Stars
		self.tfixed = wx.Menu()
		self.tfixed.Append(self.ID_FixStars,        mtexts.menutxts['TMFixStars'],        mtexts.menutxts['TMFixStarsDoc'])
		self.tfixed.Append(self.ID_FixStarsAsps,    mtexts.menutxts['TMFixStarsAsps'],    mtexts.menutxts['TMFixStarsAspsDoc'])
		self.tfixed.Append(self.ID_FixStarsParallels, mtexts.menutxts['TMFixStarsParallels'], mtexts.menutxts['TMFixStarsParallelsDoc'])
		self.tfixed.Append(self.ID_Paranatellonta,  mtexts.menutxts['TMParanatellonta'],  mtexts.menutxts['TMParanatellontaDoc'])
		self.tfixed.Append(self.ID_AngleAtBirth,    mtexts.menutxts['TMAngleAtBirth'],    mtexts.menutxts['TMAngleAtBirthDoc'])
		self.mtable.Append(self.ID_FixedStarsMenu, mtexts.txts['FixStars'], self.tfixed)

		# Time Lords
		self.ttimelords = wx.Menu()
		self.ttimelords.Append(self.ID_Profections,        mtexts.menutxts['TMProfections'],        mtexts.menutxts['TMProfectionsDoc'])
		self.ttimelords.Append(self.ID_Firdaria,           mtexts.menutxts['TMFirdaria'],           mtexts.menutxts['TMFirdariaDoc'])
		self.ttimelords.Append(self.ID_Decennials,        mtexts.menutxts['TMDecennials'],        mtexts.menutxts['TMDecennialsDoc'])
		self.ttimelords.Append(self.ID_ZodiacalReleasing,  mtexts.menutxts['TMZodiacalReleasing'],  mtexts.menutxts['TMZodiacalReleasingDoc'])
		self.ttimelords.Append(self.ID_Circumambulation,   mtexts.menutxts['TMCircumambulation'],   mtexts.menutxts['TMCircumambulationDoc'])
		
		self.mtable.Append(self.ID_TimeLordsMenu, mtexts.txts['TimeLords'], self.ttimelords)

		# Primary Directions
		self.tpd = wx.Menu()
		self.tpd.Append(self.ID_PrimaryDirs,        mtexts.menutxts['TMPrimaryDirs'],        mtexts.menutxts['TMPrimaryDirsDoc'])
		self.tpd.Append(self.ID_FixStarAngleDirs,   mtexts.menutxts['TMFixStarAngleDirs'],   mtexts.menutxts['TMFixStarAngleDirsDoc'])
		self.tpd.Append(self.ID_MunPos,           mtexts.menutxts['TMMunPos'],           mtexts.menutxts['TMMunPosDoc']) 
		self.tpd.Append(self.ID_CustomerSpeculum,   mtexts.menutxts['TMCustomerSpeculum'],   mtexts.menutxts['TMCustomerSpeculumDoc'])
		self.mtable.Append(self.ID_PrimaryDirsMenu, mtexts.txts['PrimaryDirs'], self.tpd)

		# Un-grouped (요청대로 단독 유지)
		self.mtable.Append(self.ID_ExactTransits, mtexts.menutxts['TMExactTransits'], mtexts.menutxts['TMExactTransitsDoc'])
		self.mtable.Append(self.ID_SearchModule, mtexts.txts.get('Search', 'Search')+'...\tS', 'Open the multi-technique search pane')

		#Charts-menu
		# 앞부분: 기본 항목 먼저
		self.chartsmenu2 = wx.Menu()
		self.chartsmenu2.Append(self.ID_SquareChart,     mtexts.menutxts['PMSquareChart'],     mtexts.menutxts['PMSquareChartDoc'])
		self.chartsmenu2.Append(self.ID_MundaneChart,    mtexts.menutxts['PMMundane'],         mtexts.menutxts['PMMundaneDoc'])
		self.chartsmenu2.Append(self.ID_Elections,       mtexts.menutxts['PMElections'],       mtexts.menutxts['PMElectionsDoc'])
		self.mcharts.Append(self.ID_ChartsMenu, mtexts.txts['DCharts'], self.chartsmenu2)

		self.mcharts.Append(self.ID_ProfectionsChart,mtexts.menutxts['PMProfections'],     mtexts.menutxts['PMProfectionsDoc'])

		# Secondary Progressions 서브메뉴(기존 그대로)
		self.csecprog = wx.Menu()
		self.csecprog.Append(self.ID_SecProgChart,     mtexts.menutxts['PMSecondaryDirs'],    mtexts.menutxts['PMSecondaryDirsDoc'])
		self.csecprog.Append(self.ID_SecProgPositions, mtexts.menutxts['PMPositionForDate'],  mtexts.menutxts['PMPositionForDateDoc'])
		self.mcharts.Append(self.ID_SecProgMenu, mtexts.txts['SecondaryDirs'], self.csecprog)

		self.mcharts.Append(self.ID_Revolutions,     'Solar Revolution\tR',     'Open solar revolution with saved settings')
		self.mcharts.Append(self.ID_LunarRevolution, 'Lunar Revolution\tL',     'Open lunar revolution with saved settings')
		self.crevolutions = wx.Menu()
		self.crevolutions.Append(self.ID_Rev_Mercury, 'Mercury Return', '')
		self.crevolutions.Append(self.ID_Rev_Venus,   'Venus Return',   '')
		self.crevolutions.Append(self.ID_Rev_Mars,    'Mars Return',    '')
		self.crevolutions.Append(self.ID_Rev_Jupiter, 'Jupiter Return', '')
		self.crevolutions.Append(self.ID_Rev_Saturn,  'Saturn Return',  '')
		self.mcharts.Append(self.ID_OtherRevolutions, 'Other Revolutions', self.crevolutions)

		# Transits 서브메뉴 신설
		self.ctransits = wx.Menu()
		self.ctransits.Append(self.ID_Transits,    mtexts.menutxts['PMTransits'],    mtexts.menutxts['PMTransitsDoc'])
		self.ctransits.Append(self.ID_SunTransits, mtexts.menutxts['PMSunTransits'], mtexts.menutxts['PMSunTransitsDoc'])
		self.mcharts.Append(self.ID_TransitsMenu, mtexts.txts['Transits'], self.ctransits)


		#Options-menu
		self.mhousesystem = wx.Menu()
		self.itplac = self.mhousesystem.Append(self.ID_Housesystem1, mtexts.menutxts['OMHSPlacidus'], '', wx.ITEM_RADIO)
		self.itkoch = self.mhousesystem.Append(self.ID_Housesystem2, mtexts.menutxts['OMHSKoch'], '', wx.ITEM_RADIO)
		self.itregio = self.mhousesystem.Append(self.ID_Housesystem3, mtexts.menutxts['OMHSRegiomontanus'], '', wx.ITEM_RADIO)
		self.itcampa = self.mhousesystem.Append(self.ID_Housesystem4, mtexts.menutxts['OMHSCampanus'], '', wx.ITEM_RADIO)
		self.itequal = self.mhousesystem.Append(self.ID_Housesystem5, mtexts.menutxts['OMHSEqual'], '', wx.ITEM_RADIO)
		self.itwholesign = self.mhousesystem.Append(self.ID_Housesystem6, mtexts.menutxts['OMHSWholeSign'], '', wx.ITEM_RADIO)
		self.itaxial = self.mhousesystem.Append(self.ID_Housesystem7, mtexts.menutxts['OMHSAxial'], '', wx.ITEM_RADIO)
		self.itmorin = self.mhousesystem.Append(self.ID_Housesystem8, mtexts.menutxts['OMHSMorinus'], '', wx.ITEM_RADIO)
		self.ithoriz = self.mhousesystem.Append(self.ID_Housesystem9, mtexts.menutxts['OMHSHorizontal'], '', wx.ITEM_RADIO)
		self.itpage = self.mhousesystem.Append(self.ID_Housesystem10, mtexts.menutxts['OMHSPagePolich'], '', wx.ITEM_RADIO)
		self.italcab = self.mhousesystem.Append(self.ID_Housesystem11, mtexts.menutxts['OMHSAlcabitus'], '', wx.ITEM_RADIO)
		self.itporph = self.mhousesystem.Append(self.ID_Housesystem12, mtexts.menutxts['OMHSPorphyrius'], '', wx.ITEM_RADIO)
		self.itnohouses = self.mhousesystem.Append(self.ID_Housesystem13, mtexts.menutxts.get('OMHSNoHouses', 'Angles only (no house lines)'), '', wx.ITEM_RADIO)

		# [Appearance1] submenu: Appearance1/Speculum(=Appearance2)/Colors/Symbols
		self.o_appearance = wx.Menu()
		self.o_appearance.Append(self.ID_Appearance1, mtexts.menutxts['OMAppearance1'], mtexts.menutxts['OMAppearance1Doc'])
		self.o_appearance.Append(self.ID_NatalSecondaryCycle, 'Cycle secondary view\tCtrl+G', 'Cycles the radix secondary view')

		self.o_appearance.Append(self.ID_Colors,      mtexts.menutxts['OMColors'],      mtexts.menutxts['OMColorsDoc'])
		self.o_appearance.Append(self.ID_Symbols,     mtexts.menutxts['OMSymbols'],     mtexts.menutxts['OMSymbolsDoc'])
		self.moptions.Append(self.ID_AppearanceOptMenu, mtexts.txts['DDCharts'], self.o_appearance)

		self.o_appearance.Append(self.ID_Ayanamsha, mtexts.menutxts['OMAyanamsha'], mtexts.menutxts['OMAyanamshaDoc'])
		self.o_appearance.Append(self.ID_HouseSystem, mtexts.menutxts['OMHouseSystem'], self.mhousesystem)
		self.setHouse()

		self.o_planetsopt = wx.Menu()
		self.o_planetsopt.Append(self.ID_Appearance2, mtexts.menutxts['OMAppearance2'], mtexts.menutxts['OMAppearance2Doc'])
		self.o_planetsopt.Append(self.ID_Orbs, mtexts.menutxts['OMOrbs'], mtexts.menutxts['OMOrbsDoc'])
		# [Dignities] submenu: Dignities + Minor Dignities(submenu)
		self.o_digs = wx.Menu()
		self.o_digs.Append(self.ID_Dignities, mtexts.menutxts['OMDignities'], mtexts.menutxts['OMDignitiesDoc'])
		self.mdignities = wx.Menu()
		self.mdignities.Append(self.ID_Triplicities, mtexts.menutxts['OMTriplicities'], mtexts.menutxts['OMTriplicitiesDoc'])
		self.mdignities.Append(self.ID_Terms,        mtexts.menutxts['OMTerms'],        mtexts.menutxts['OMTermsDoc'])
		self.mdignities.Append(self.ID_Decans,       mtexts.menutxts['OMDecans'],       mtexts.menutxts['OMDecansDoc'])
		self.o_digs.Append(self.ID_MinorDignities, mtexts.menutxts['OMMinorDignities'], self.mdignities)
		self.o_planetsopt.Append(self.ID_DignitiesOptMenu, mtexts.txts['Dignities'], self.o_digs)
		self.mnodes = wx.Menu()
		self.meanitem = self.mnodes.Append(self.ID_NodeMean, mtexts.menutxts['OMNMean'], '', wx.ITEM_RADIO)
		self.trueitem = self.mnodes.Append(self.ID_NodeTrue, mtexts.menutxts['OMNTrue'], '', wx.ITEM_RADIO)
		self.o_planetsopt.Append(self.ID_Nodes, mtexts.menutxts['OMNodes'], self.mnodes)
		self.setNode()
		# [ArabicParts] submenu: Arabic Parts(first) + Fortuna(second)
		self.o_arabic = wx.Menu()
		self.o_arabic.Append(self.ID_ArabicParts,  mtexts.menutxts['OMArabicParts'],  mtexts.menutxts['OMArabicPartsDoc'])
		self.o_arabic.Append(self.ID_LotOfFortune, mtexts.menutxts['OMLotFortune'],   mtexts.menutxts['OMLotFortuneDoc'])
		self.o_planetsopt.Append(self.ID_ArabicPartsOptMenu, mtexts.txts['ArabicParts'], self.o_arabic)

		self.o_planetsopt.Append(self.ID_Syzygy,      mtexts.menutxts['OMSyzygy'],      mtexts.menutxts['OMSyzygyDoc'])
		self.moptions.Append(self.ID_PlanetsPointsOptMenu, mtexts.txts['PlanetsPoints'], self.o_planetsopt)

		self.malmutens = wx.Menu()
		self.malmutens.Append(self.ID_ChartAlmuten, mtexts.menutxts['OMChartAlmuten'], mtexts.menutxts['OMChartAlmutenDoc'])
		self.malmutens.Append(self.ID_Topical, mtexts.menutxts['OMTopical'], mtexts.menutxts['OMTopicalDoc'])
		self.moptions.Append(self.ID_Almutens, mtexts.menutxts['OMAlmutens'], self.malmutens)

		self.moptions.Append(self.ID_FixStarsOpt, mtexts.menutxts['OMFixStarsOpt'], mtexts.menutxts['OMFixStarsOptDoc'])
		
		# [TimeLords] submenu: Profections + Firdaria
		self.o_tl = wx.Menu()
		self.o_tl.Append(self.ID_ProfectionsOpt, mtexts.menutxts['OMProfectionsOpt'], mtexts.menutxts['OMProfectionsOptDoc'])
		self.o_tl.Append(self.ID_FirdariaOpt,    mtexts.menutxts['OMFirdariaOpt'],    mtexts.menutxts['OMFirdariaOptDoc'])
		self.moptions.Append(self.ID_TimeLordsOptMenu, mtexts.txts['TimeLords'], self.o_tl)

		# [PrimaryDirs] submenu: Primary Dirs + Primary Keys + PDs in Chart(submenu)
		self.o_pd = wx.Menu()
		self.o_pd.Append(self.ID_PrimaryDirsOpt, mtexts.menutxts['OMPrimaryDirs'], mtexts.menutxts['OMPrimaryDirsDoc'])
		self.o_pd.Append(self.ID_PrimaryKeys,    mtexts.menutxts['OMPrimaryKeys'], mtexts.menutxts['OMPrimaryKeysDoc'])
		self.mpdsinchartopts = wx.Menu()
		self.mpdsinchartopts.Append(self.ID_PDsInChartOptZod, mtexts.menutxts['OMPDsInChartOptZod'], mtexts.menutxts['OMPDsInChartOptZodDoc'])
		self.mpdsinchartopts.Append(self.ID_PDsInChartOptMun, mtexts.menutxts['OMPDsInChartOptMun'], mtexts.menutxts['OMPDsInChartOptMunDoc'])
		self.o_pd.Append(self.ID_PDsInChartOpt, mtexts.menutxts['OMPDsInChartOpt'], self.mpdsinchartopts)
		self.moptions.Append(self.ID_PrimaryDirsOptMenu, mtexts.txts['PrimaryDirs'], self.o_pd)

# Roberto change V 7.2.0
		self.moptions.Append(self.ID_DefLocationOpt, mtexts.menutxts['OMDefLocationOpt'], mtexts.menutxts['OMDefLocationOptDoc'])
		# ###########################################
		self.moptions.Append(self.ID_RevolutionsOpt, 'Revolutions', 'Shows revolution settings')
		self.moptions.Append(self.ID_QuickChartsOpt, 'Supplementary Charts', 'Shows quick supplemental chart settings')
		self.moptions.Append(self.ID_StepAlertsOpt, 'Stepping Alerts', 'Shows exact stepping alert settings')
		self.moptions.Append(self.ID_Languages, mtexts.menutxts['OMLanguages'], mtexts.menutxts['OMLanguagesDoc'])
		self.moptions.AppendSeparator()
		self.autosave = self.moptions.Append(self.ID_AutoSaveOpts, mtexts.menutxts['OMAutoSave'], mtexts.menutxts['OMAutoSaveDoc'], wx.ITEM_CHECK)
		self.moptions.Append(self.ID_SaveOpts, mtexts.menutxts['OMSave'], mtexts.menutxts['OMSaveDoc'])
		self.moptions.Append(self.ID_Reload, mtexts.menutxts['OMReload'], mtexts.menutxts['OMReloadDoc'])

		self.setAutoSave()

		#Help-menu
		self.mhelp.Append(self.ID_Help, mtexts.menutxts['HEMHelp'], mtexts.menutxts['HEMHelpDoc'])
		self.mhelp.Append(self.ID_About, mtexts.menutxts['HEMAbout'], mtexts.menutxts['HEMAboutDoc'])


		menubar.Append(self.mhoros,   mtexts.menutxts[u'MHoroscope'])
		menubar.Append(self.mtable,   mtexts.menutxts[u'MTable'])
		menubar.Append(self.mcharts,  mtexts.menutxts[u'MCharts'])
		menubar.Append(self.moptions, mtexts.menutxts[u'MOptions'])
		menubar.Append(self.mhelp,    mtexts.menutxts[u'MHelp'])

		for item in self.mhoros.GetMenuItems():
			face = {6: 'Noto Sans SC', 7: 'Noto Sans TC', 8: 'Noto Sans KR'}.get(self.options.langid, 'FreeSans')
			item.SetFont(wx.Font(10, wx.FONTFAMILY_DEFAULT, wx.FONTSTYLE_NORMAL, wx.FONTWEIGHT_NORMAL, False, face))

		self.SetMenuBar(menubar)
		# Window icon:
		# - Windows: use ICO
		# - macOS/Linux: ICO handler may be unavailable, fall back to a PNG in Res
		try:
			if wx.Platform == '__WXMSW__':
				self.SetIcon(wx.Icon(os.path.join('Res', 'Morinus.ico'), wx.BITMAP_TYPE_ICO))
			else:
				png_path = os.path.join('Res', 'charts.png')
				if os.path.exists(png_path):
					bmp = wx.Bitmap(png_path, wx.BITMAP_TYPE_PNG)
					ico = wx.Icon()
					ico.CopyFromBitmap(bmp)
					self.SetIcon(ico)
		except Exception:
			pass
		self.CreateStatusBar()
		self._apply_statusbar_colours()

		self._workspace_shell = workspace_shell.MainWindowShell(
			self,
			self.options,
			chart_context_menu_handler=self.onChartContextMenu,
			chart_resize_handler=self._handle_chart_host_resize,
			navigator_state_provider=self._workspace_navigation_state,
			navigator_action_handler=self._handle_workspace_action,
			navigator_document_handler=self._handle_workspace_document,
			navigator_document_close_handler=self._handle_workspace_document_close,
			navigator_document_context_handler=self._handle_workspace_document_context,
			navigator_open_path_handler=self._open_workspace_chart_path,
			navigator_document_move_handler=self._handle_workspace_document_move,
		)
		self._frame_sizer = wx.BoxSizer(wx.VERTICAL)
		self._frame_sizer.Add(self._workspace_shell, 1, wx.EXPAND)
		self.SetSizer(self._frame_sizer)
		self.Layout()
		self._fit_workspace_startup_geometry()

		self.Bind(wx.EVT_MENU, self.onNew, id=self.ID_New)
		self.Bind(wx.EVT_MENU, self.onData, id=self.ID_Data)
		self.Bind(wx.EVT_MENU, self.onLoad, id=self.ID_Load)
# ###########################################
# Roberto change  V 7.2.0		
		self.Bind(wx.EVT_MENU, self.onHereAndNow, id=self.ID_HereAndNow)
# ###########################################
		self.Bind(wx.EVT_MENU, self.onSave, id=self.ID_Save)
		self.Bind(wx.EVT_MENU, self.onSaveAsBitmap, id=self.ID_SaveAsBitmap)
		self.Bind(wx.EVT_MENU, self.onSynastry, id=self.ID_Synastry)
		self.Bind(wx.EVT_MENU, self.onFindTime, id=self.ID_FindTime)
		self.Bind(wx.EVT_MENU, self.onEphemeris, id=self.ID_Ephemeris)
		self.Bind(wx.EVT_MENU, self.onClose, id=self.ID_Close)
		self.Bind(wx.EVT_MENU, self.onExit, id=self.ID_Exit)

		self.Bind(wx.EVT_MENU_OPEN, self.onMenuOpen)
		#The events EVT_MENU_OPEN and CLOSE are not called on windows in case of accelarator-keys
		self.Bind(wx.EVT_MENU_CLOSE, self.onMenuClose)

		self.Bind(wx.EVT_MENU, self.onPositions, id=self.ID_Positions)
		self.Bind(wx.EVT_MENU, self.onAlmutenZodiacal, id=self.ID_AlmutenZodiacal)
		self.Bind(wx.EVT_MENU, self.onAlmutenChart, id=self.ID_AlmutenChart)
		self.Bind(wx.EVT_MENU, self.onAlmutenTopical, id=self.ID_AlmutenTopical)
		self.Bind(wx.EVT_MENU, self.onMisc, id=self.ID_Misc)
		self.Bind(wx.EVT_MENU, self.onMunPos, id=self.ID_MunPos)
		self.Bind(wx.EVT_MENU, self.onAntiscia, id=self.ID_Antiscia)
# ###################################
# Elias change v 8.0.0    
#		self.Bind(wx.EVT_MENU, self.onDodecatemoria, id=self.ID_Dodecatemoria)
# ###################################	
		self.Bind(wx.EVT_MENU, self.onAspects, id=self.ID_Aspects)
		self.Bind(wx.EVT_MENU, self.onFixStars, id=self.ID_FixStars)
		self.Bind(wx.EVT_MENU, self.onFixStarsAsps, id=self.ID_FixStarsAsps)
		self.Bind(wx.EVT_MENU, self.onFixStarsParallels, id=self.ID_FixStarsParallels)
		self.Bind(wx.EVT_MENU, self.onMidpoints, id=self.ID_Midpoints)
		self.Bind(wx.EVT_MENU, self.onRiseSet, id=self.ID_RiseSet)
		self.Bind(wx.EVT_MENU, self.onSpeeds, id=self.ID_Speeds)
		self.Bind(wx.EVT_MENU, self.onZodPars, id=self.ID_ZodPars)
		self.Bind(wx.EVT_MENU, self.onArabians, id=self.ID_Arabians)
		self.Bind(wx.EVT_MENU, self.onStrip, id=self.ID_Strip)
		self.Bind(wx.EVT_MENU, self.onPlanetaryHours, id=self.ID_PlanetaryHours)
		self.Bind(wx.EVT_MENU, self.onExactTransits, id=self.ID_ExactTransits)
		self.Bind(wx.EVT_MENU, self.onSearchModule, id=self.ID_SearchModule)
		self.Bind(wx.EVT_MENU, self.onProfections, id=self.ID_Profections)
# ###########################################
# Roberto change V 7.3.0
		self.Bind(wx.EVT_MENU, self.onFirdaria, id=self.ID_Firdaria)
# ###########################################
# ###################################
# Roberto change v 8.0.1   
		self.Bind(wx.EVT_MENU, self.onDodecatemoria, id=self.ID_Dodecatemoria)
		self.Bind(wx.EVT_MENU, self.onAngleAtBirth, id=self.ID_AngleAtBirth)
		self.Bind(wx.EVT_MENU, self.onCustomerSpeculum, id=self.ID_CustomerSpeculum)
		self.Bind(wx.EVT_MENU, self.onPrimaryDirs, id=self.ID_PrimaryDirs)
		self.Bind(wx.EVT_MENU, self.onZodiacalReleasing, id=self.ID_ZodiacalReleasing)
		self.Bind(wx.EVT_MENU, self.onPhasis, id=self.ID_Phasis)
		self.Bind(wx.EVT_MENU, self.onParanatellonta, id=self.ID_Paranatellonta)
		self.Bind(wx.EVT_MENU, self.onCircumambulation, id=self.ID_Circumambulation)
		self.Bind(wx.EVT_MENU, self.onDecennials, id=self.ID_Decennials)
		self.Bind(wx.EVT_MENU, self.onFixStarAngleDirs, id=self.ID_FixStarAngleDirs)
		self.Bind(wx.EVT_MENU, self.onEclipses, id=self.ID_Eclipses)
		self.Bind(wx.EVT_MENU, self.onTransits, id=self.ID_Transits)
		self.Bind(wx.EVT_MENU, self.onQuickSolarRevolution, id=self.ID_Revolutions)
		self.Bind(wx.EVT_MENU, self.onQuickLunarRevolution, id=self.ID_LunarRevolution)
		self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.MERCURY), id=self.ID_Rev_Mercury)
		self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.VENUS),   id=self.ID_Rev_Venus)
		self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.MARS),    id=self.ID_Rev_Mars)
		self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.JUPITER), id=self.ID_Rev_Jupiter)
		self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.SATURN),  id=self.ID_Rev_Saturn)
		self.Bind(wx.EVT_MENU, self.onSunTransits, id=self.ID_SunTransits)
		self.Bind(wx.EVT_MENU, self.onSecondaryDirs, id=self.ID_SecondaryDirs)
		self.Bind(wx.EVT_MENU, self.onSecondaryDirs, id=self.ID_SecProgChart)
		self.Bind(wx.EVT_MENU, self.onSecProgPositionsByDate, id=self.ID_SecProgPositions)
		self.Bind(wx.EVT_MENU, self.onElections, id=self.ID_Elections)
		self.Bind(wx.EVT_MENU, self.onSquareChart, id=self.ID_SquareChart)
		self.Bind(wx.EVT_MENU, self.onProfectionsChart, id=self.ID_ProfectionsChart)
		self.Bind(wx.EVT_MENU, self.onMundaneChart, id=self.ID_MundaneChart)

		self.Bind(wx.EVT_MENU, self.onAppearance1, id=self.ID_Appearance1)
		self.Bind(wx.EVT_MENU, self.onAppearance2, id=self.ID_Appearance2)
		self.Bind(wx.EVT_MENU, self.onSymbols, id=self.ID_Symbols)
		self.Bind(wx.EVT_MENU, self.onDignities, id=self.ID_Dignities)
		self.Bind(wx.EVT_MENU, self.onAyanamsha, id=self.ID_Ayanamsha)
		self.Bind(wx.EVT_MENU, self.onColors, id=self.ID_Colors)
		self.Bind(wx.EVT_MENU_RANGE, self.onHouseSystem, id=self.ID_Housesystem1, id2=self.ID_Housesystem13)
		self.Bind(wx.EVT_MENU_RANGE, self.onNodes, id=self.ID_NodeMean, id2=self.ID_NodeTrue)
		self.Bind(wx.EVT_MENU, self.onOrbs, id=self.ID_Orbs)
		self.Bind(wx.EVT_MENU, self.onPrimaryDirsOpt, id=self.ID_PrimaryDirsOpt)
		self.Bind(wx.EVT_MENU, self.onPrimaryKeys, id=self.ID_PrimaryKeys)
		self.Bind(wx.EVT_MENU, self.onPDsInChartOptZod, id=self.ID_PDsInChartOptZod)
		self.Bind(wx.EVT_MENU, self.onPDsInChartOptMun, id=self.ID_PDsInChartOptMun)
		self.Bind(wx.EVT_MENU, self.onFortune, id=self.ID_LotOfFortune)
		self.Bind(wx.EVT_MENU, self.onArabicParts, id=self.ID_ArabicParts)
		self.Bind(wx.EVT_MENU, self.onSyzygy, id=self.ID_Syzygy)
		self.Bind(wx.EVT_MENU, self.onFixStarsOpt, id=self.ID_FixStarsOpt)
		self.Bind(wx.EVT_MENU, self.onProfectionsOpt, id=self.ID_ProfectionsOpt)
# ###########################################
# Roberto change  V 7.3.0
		self.Bind(wx.EVT_MENU, self.onFirdariaOpt, id=self.ID_FirdariaOpt)
# ###########################################	
		# ###########################################
		# Roberto change  V 7.2.0
		self.Bind(wx.EVT_MENU, self.onDefLocationOpt, id=self.ID_DefLocationOpt)
		# ###########################################		
		self.Bind(wx.EVT_MENU, self.onRevolutionsOpt, id=self.ID_RevolutionsOpt)
		self.Bind(wx.EVT_MENU, self.onQuickChartsOpt, id=self.ID_QuickChartsOpt)
		self.Bind(wx.EVT_MENU, self.onStepAlertsOpt, id=self.ID_StepAlertsOpt)
		self.Bind(wx.EVT_MENU, self.onSetStartupChart, id=self.ID_SetStartupChart)
		self.Bind(wx.EVT_MENU, self.onClearStartupChart, id=self.ID_ClearStartupChart)
		
		
		self.Bind(wx.EVT_MENU, self.onLanguages, id=self.ID_Languages)
		self.Bind(wx.EVT_MENU, self.onTriplicities, id=self.ID_Triplicities)
		self.Bind(wx.EVT_MENU, self.onTerms, id=self.ID_Terms)
		self.Bind(wx.EVT_MENU, self.onDecans, id=self.ID_Decans)
		self.Bind(wx.EVT_MENU, self.onChartAlmuten, id=self.ID_ChartAlmuten)
		self.Bind(wx.EVT_MENU, self.onTopicals, id=self.ID_Topical)
		self.Bind(wx.EVT_MENU, self.onAutoSaveOpts, id=self.ID_AutoSaveOpts)
		self.Bind(wx.EVT_MENU, self.onSaveOpts, id=self.ID_SaveOpts)
		self.Bind(wx.EVT_MENU, self.onReload, id=self.ID_Reload)

		self.Bind(wx.EVT_MENU, self.onHelp, id=self.ID_Help)
		self.Bind(wx.EVT_MENU, self.onAbout, id=self.ID_About)
		self.Bind(wx.EVT_MENU, self.onAngleAtBirth, id=self.ID_AngleAtBirth)
		self.Bind(wx.EVT_MENU, self.onCycleNatalSecondaryRing, id=self.ID_NatalSecondaryCycle)
		for item_id in self._radix_overlay_mode_by_id:
			self.Bind(wx.EVT_MENU, self.onRadixOverlayMenu, id=item_id)
		for item_id in self._radix_display_toggle_by_id:
			self.Bind(wx.EVT_MENU, self.onRadixDisplayToggleMenu, id=item_id)
		self.Bind(wx.EVT_MENU, self.onCloseWindowShortcut, id=wx.ID_CLOSE)
		self.Bind(wx.EVT_CHAR_HOOK, self.onCharHook)
		self.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)
		self.Bind(wx.EVT_ACTIVATE, self.onFrameActivate)
		self.Bind(wx.EVT_SIZE, self.onFrameSize)
		self.SetAcceleratorTable(wx.AcceleratorTable([
			(wx.ACCEL_CMD, ord('W'), wx.ID_CLOSE),
			(wx.ACCEL_NORMAL, ord('S'), self.ID_SearchModule),
			(wx.ACCEL_CTRL, wx.WXK_F11, self.ID_AngleAtBirth),
			(wx.ACCEL_CTRL, ord('1'),  self.ID_ZodiacalReleasing),  # <-- 추가
			(wx.ACCEL_CTRL, ord('2'),  self.ID_Phasis),  # <-- 추가
			(wx.ACCEL_CTRL, ord('3'),  self.ID_Paranatellonta),
			(wx.ACCEL_CTRL, ord('4'),  self.ID_Circumambulation),
			(wx.ACCEL_CTRL, ord('5'),  self.ID_FixStarAngleDirs),
			(wx.ACCEL_NORMAL, wx.WXK_F5, self.ID_Misc),
			(wx.ACCEL_CTRL, ord('6'),  self.ID_Eclipses),
			(wx.ACCEL_CTRL, ord('8'),  self.ID_FixStarsParallels),
	(wx.ACCEL_CTRL | wx.ACCEL_SHIFT, wx.WXK_F4, self.ID_SecProgChart),
	(wx.ACCEL_CTRL | wx.ACCEL_SHIFT, wx.WXK_F5, self.ID_Elections),
	(wx.ACCEL_CTRL | wx.ACCEL_SHIFT, wx.WXK_F9, self.ID_SecProgPositions),
		]))
		self._apply_custom_shortcut_labels()

		self.Bind(wx.EVT_CLOSE, self.onExit)

		self.enableMenus(False)

		self.moptions.Enable(self.ID_SaveOpts, True)
		if self.options.checkOptsFiles():
			self.moptions.Enable(self.ID_Reload, True)
		else:
			self.moptions.Enable(self.ID_Reload, False)

		self.trdatedlg = None
		self.trmondlg = None
		self.suntrdlg = None
		self.revdlg = None
		self.secdirdlg = None
		self.pdrangedlg = None
		self._active_table_action = None
		self._pd_for_workspace = False

		os.environ['SE_EPHE_PATH'] = ''
		astrology.swe_set_ephe_path(common.common.ephepath)
		# Diagnostics for frozen macOS builds: confirm ephemeris path resolves.
		try:
			import sys as _sys
			import os as _os
			if getattr(_sys, "frozen", False):
				_ep = common.common.ephepath
				print("ephepath(rel):", _ep)
				print("ephepath(abs):", _os.path.abspath(_ep))
				print("ephe exists:", _os.path.exists(_os.path.join(_ep, "sepl_18.se1")))
		except Exception:
			pass
		
		self.drawSplash()
		wx.CallAfter(self._load_startup_chart_if_configured)

		self.Bind(EVT_PDREADY, self.OnPDReady)


	#Horoscope-menu	
	def onNew(self, event):
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			self._workspace_new_chart(event)
			return

		dlg = personaldatadlg.PersonalDataDlg(self, self.options.langid)
		dlg.CenterOnParent()
		dlg.initialize()

		# this does not return until the dialog is closed.
		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			self.dirty = True

			direc = dlg.placerbE.GetValue()
			hemis = dlg.placerbN.GetValue()

			place = chart.Place(dlg.birthplace.GetValue(), int(dlg.londeg.GetValue()), int(dlg.lonmin.GetValue()), 0, direc, int(dlg.latdeg.GetValue()), int(dlg.latmin.GetValue()), 0, hemis, int(dlg.alt.GetValue()))

			time = self._chart_time_from_dialog(dlg, place)

			male = dlg.genderrbM.GetValue()
			self.horoscope = chart.Chart(dlg.name.GetValue(), male, time, place, dlg.typecb.GetCurrentSelection(), dlg.notes.GetValue(), self.options)
			self.splash = False	
			self.enableMenus(True)
			self.drawBkg()
			self.Refresh()
			self.handleStatusBar(True)
			self.handleCaption(True)
#			self.calc()##

		dlg.Destroy()


	def onData(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = personaldatadlg.PersonalDataDlg(self, self.options.langid)
		dlg.CenterOnParent()
		dlg.fill(self.horoscope)

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			changed = dlg.check(self.horoscope)

			#if self.dirty and changed:
			if changed:
				dlgm = wx.MessageDialog(self, mtexts.txts['DiscardCurrHor'], mtexts.txts['Confirm'], wx.YES_NO|wx.ICON_QUESTION)
				if dlgm.ShowModal() == wx.ID_NO:
					self.save()
				dlgm.Destroy()#

			if changed:
				self.dirty = True

			direc = dlg.placerbE.GetValue()
			hemis = dlg.placerbN.GetValue()
			place = chart.Place(dlg.birthplace.GetValue(), int(dlg.londeg.GetValue()), int(dlg.lonmin.GetValue()), 0, direc, int(dlg.latdeg.GetValue()), int(dlg.latmin.GetValue()), 0, hemis, int(dlg.alt.GetValue()))

			time = self._chart_time_from_dialog(dlg, place)

			male = dlg.genderrbM.GetValue()
			self.horoscope = chart.Chart(dlg.name.GetValue(), male, time, place, dlg.typecb.GetCurrentSelection(), dlg.notes.GetValue(), self.options)
			self.splash = False	
			self.enableMenus(True)
			self.drawBkg()
			self.Refresh()
			self.handleStatusBar(True)
			self.handleCaption(True)
#			self.calc()##

			if changed:
				self.closeChildWnds()

		dlg.Destroy()
		

# ###########################################
# Roberto change  V 7.2.0		
	def onHereAndNow(self, event):
				
		self.dirty = True
	
		place = chart.Place(self.options.deflocname, self.options.defloclondeg, self.options.defloclonmin, 0, self.options.defloceast, self.options.defloclatdeg, self.options.defloclatmin, 0, self.options.deflocnorth, self.options.deflocalt)
	
		now = datetime.datetime.now()
		time = chart.Time(now.year, now.month, now.day, now.hour, now.minute, now.second, False, chart.Time.GREGORIAN, chart.Time.ZONE, self.options.deflocplus, self.options.defloczhour, self.options.defloczminute, self.options.deflocdst, place, tzid=getattr(self.options, 'defloctzid', ''), tzauto=getattr(self.options, 'defloctzauto', True))
	
		self.horoscope = chart.Chart(mtexts.txts['HereAndNow'], True, time, place, chart.Chart.HORARY, '', self.options)
		self.splash = False	
		self.enableMenus(True)
		self.drawBkg()
		self.Refresh()
		self.handleStatusBar(True)
		self.handleCaption(True)
# ###########################################


	def showFindTime(self, bc, fnd, arplac):
		place = chart.Place('London, GBR', 0, 6, 0, False, 51, 31, 0, True, 10)

		h, m, s = util.decToDeg(fnd[3])
		time = chart.Time(fnd[0], fnd[1], fnd[2], h, m, s, bc, chart.Time.GREGORIAN, chart.Time.GREENWICH, True, 0, 0, False, place)
		#Calc obliquity
		d = astrology.swe_deltat(time.jd)
		serr, obl = astrology.swe_calc(time.jd+d, astrology.SE_ECL_NUT, 0)

		if arplac[2]:
			#calc GMTMidnight:
			timeMidnight = chart.Time(time.year, time.month, time.day, 0, 0, 0, bc, chart.Time.GREGORIAN, chart.Time.GREENWICH, True, 0, 0, False, place)
			place = self.calcPlace(time.time, timeMidnight.sidTime, arplac[0], arplac[1], obl[0])

		url = "http://api.geonames.org/findNearbyJSON?%s"

		params = {
			"username" : 'morinus',
			#"lang" : "en",
			"lng" : place.lon,
			"lat" : place.lat,
			"featureClass" : "P"
			}

		url = url % urllib.parse.urlencode(params)
		place1 = ""
		try:
			page = urllib2.urlopen(url)
			doc = json.loads(page.read())

			for item in doc['geonames']:
				place1 = item['toponymName']
				values = place1
				place1 = item['countryName']
				values = values+", "+place1

		except Exception as e:
			values = None

		place.place=values

		self.horoscope = chart.Chart('Search', True, time, place, chart.Chart.RADIX, '', self.options)

		if (not self.splash):
			self.destroyDlgs()
			self.closeChildWnds()

		self.dirty = True
		self.splash = False	
		self.fpath = ''
		self.enableMenus(True)
		self.clickedPlId = None
		self.drawBkg()
		self.Refresh()
		self.handleStatusBar(True)
		self.handleCaption(True)


	def calcPlace(self, gmt, gmst0, mclon, asclon, obl):
		robl = math.radians(obl)
		deltaGMST = gmt*1.00273790927949
		gmstNat = util.normalizeTime(gmst0+deltaGMST)

		ramc = 0.0
		if mclon == 90.0:
			ramc = 90.0
		elif mclon == 270.0:
			ramc = 270.0
		else:
			rmclon = math.radians(mclon)
			X = math.degrees(math.atan(math.tan(rmclon)*math.cos(robl)))
			if mclon >= 0.0 and mclon < 90.0:
				ramc = X
			elif mclon > 90.0 and mclon < 270.0:
				ramc = X+180.0
			elif mclon > 270.0 and mclon < 360.0:
				ramc = X+360.0

		lmstNat = ramc/15.0

		lonInTime = gmstNat-lmstNat

		if not (-12.0 <= lonInTime and lonInTime <= 12.0):
			if lonInTime < -12.0:
				lonInTime += 24.0
			elif lonInTime > 12.0:
				lonInTime -= 24.0

		lon = 0.0
		east = False
		if lonInTime == 0.0:
			lon = 0.0
		elif 0.0 < lonInTime and lonInTime <= 12.0: #West
			lon = lonInTime*15.0
		elif -12.0 <= lonInTime and lonInTime < 0.0: #East
			lon = lonInTime*15.0
			east = True

		#Lat
		rasclon = math.radians(asclon)
		rramc = math.radians(ramc)

		lat = 30.0#
		north = True
		if math.sin(robl) != 0.0:
			lat = math.degrees(math.atan(-(math.cos(rramc)*(1/math.tan(rasclon))+math.sin(rramc)*math.cos(robl))/math.sin(robl)))
			if lat < 0.0:
				north = False

		lon = math.fabs(lon)
		lat = math.fabs(lat)
		
		ld, lm, ls = util.decToDeg(lon)
		lad, lam, las = util.decToDeg(lat)

		return chart.Place('Place', ld, lm, ls, east, lad, lam, las, north, 10)


	def onLoad(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.dirty:
			dlgm = wx.MessageDialog(self, mtexts.txts['DiscardCurrHor'], mtexts.txts['Confirm'], wx.YES_NO|wx.ICON_QUESTION)
			if dlgm.ShowModal() == wx.ID_NO:
				dlgm.Destroy()#
				return

			dlgm.Destroy()#

		if sys.platform == 'darwin':
			fpath = macfiledialog.choose_file(self.fpathhors)
			if fpath:
				dpath = os.path.dirname(fpath)
				if not fpath.lower().endswith(u'.hor'):
					fpath+=u'.hor'
				chrt = self.subLoad(fpath, dpath, True)
				if chrt != None:
					self._activate_loaded_chart(chrt, fpath, dpath)
			return
		else:
			dlg = wx.FileDialog(self, mtexts.txts['OpenHor'], '', '', u'All files (*.*)|*.*', wx.FD_OPEN)
			if os.path.isdir(self.fpathhors):
				dlg.SetDirectory(self.fpathhors)
			else:
				dlg.SetDirectory(u'.')

		if dlg.ShowModal() == wx.ID_OK:
			dpath = dlg.GetDirectory()
			fpath = dlg.GetPath()

			if not fpath.lower().endswith(u'.hor'):
				fpath+=u'.hor'

			chrt = self.subLoad(fpath, dpath, True)

			if chrt != None:
				self._activate_loaded_chart(chrt, fpath, dpath)

		dlg.Destroy()#

	def onSetStartupChart(self, event):
		if self.splash:
			return

		if self.fpath == '':
			self.save()
			if self.fpath == '':
				return

		self.options.startupchart = self.fpath
		if self.options.saveStartupChart():
			self.moptions.Enable(self.ID_SaveOpts, True)

	def onClearStartupChart(self, event):
		self.options.startupchart = ''
		if self.options.saveStartupChart():
			self.moptions.Enable(self.ID_SaveOpts, True)


	def subLoad(self, fpath, dpath, dontclose = False):
		chrt = None

		try:
			if (not self.splash) and (not dontclose):
				self.closeChildWnds()

			chrt = horfileio.read_hor_chart(fpath, self.options)
		except IOError:
			dlgm = wx.MessageDialog(self, mtexts.txts['FileError'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlgm.ShowModal()
			dlgm.Destroy()#
		except Exception:
			dlgm = wx.MessageDialog(self, mtexts.txts['FileError'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlgm.ShowModal()
			dlgm.Destroy()#

		return chrt 


	def onSave(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		self.save()


	def save(self):
		dlg = wx.FileDialog(self, mtexts.txts['SaveHor'], '', self.horoscope.name, mtexts.txts['HORFiles'], wx.FD_SAVE)
		if os.path.isdir(self.fpathhors):
			dlg.SetDirectory(self.fpathhors)
		else:
			dlg.SetDirectory(u'.')

		if dlg.ShowModal() == wx.ID_OK:
			dpath = dlg.GetDirectory()
			fpath = dlg.GetPath()

			if not fpath.endswith(u'.hor'):
				fpath+=u'.hor'
			#Check if fpath already exists!?
			if os.path.isfile(fpath):
				dlgm = wx.MessageDialog(self, mtexts.txts['FileExists'], mtexts.txts['Message'], wx.YES_NO|wx.YES_DEFAULT|wx.ICON_QUESTION)
				if dlgm.ShowModal() == wx.ID_NO:
					dlgm.Destroy()#
					return
				dlgm.Destroy()#
			
			try:
				with open(fpath, 'wb') as f:
					import pickle
					p = pickle.Pickler(f, 2)
					p.dump(self.horoscope.name)
					p.dump(self.horoscope.male)
					p.dump(self.horoscope.htype)
					p.dump(self.horoscope.time.bc)
					p.dump(self.horoscope.time.origyear)
					p.dump(self.horoscope.time.origmonth)
					p.dump(self.horoscope.time.origday)
					p.dump(self.horoscope.time.hour)
					p.dump(self.horoscope.time.minute)
					p.dump(self.horoscope.time.second)
					p.dump(self.horoscope.time.cal)
					p.dump(self.horoscope.time.zt)
					p.dump(self.horoscope.time.plus)
					p.dump(self.horoscope.time.zh)
					p.dump(self.horoscope.time.zm)
					p.dump(self.horoscope.time.daylightsaving)
					p.dump(self.horoscope.place.place)
					p.dump(self.horoscope.place.deglon)
					p.dump(self.horoscope.place.minlon)
					p.dump(self.horoscope.place.seclon)
					p.dump(self.horoscope.place.east)
					p.dump(self.horoscope.place.deglat)
					p.dump(self.horoscope.place.minlat)
					p.dump(self.horoscope.place.seclat)
					p.dump(self.horoscope.place.north)
					p.dump(self.horoscope.place.altitude)
					p.dump(self.horoscope.notes)
					p.dump(getattr(self.horoscope.time, 'tzid', ''))
					p.dump(getattr(self.horoscope.time, 'tzauto', False))
				self.fpathhors = dpath
				self.fpath = fpath
				self.dirty = False
			except IOError:
				dlgm = wx.MessageDialog(self, mtexts.txts['FileError'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
				dlgm.ShowModal()
				dlgm.Destroy()
		dlg.Destroy()#


	def onSaveAsBitmap(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		name = self.horoscope.name
		if name == '':
			name = mtexts.txts['Horoscope']
		dlg = wx.FileDialog(self, mtexts.txts['SaveAsBmp'], '', name, mtexts.txts['BMPFiles'], wx.FD_SAVE)
		if os.path.isdir(self.fpathimgs):
			dlg.SetDirectory(self.fpathimgs)
		else:
			dlg.SetDirectory(u'.')

		if dlg.ShowModal() == wx.ID_OK:
			dpath = dlg.GetDirectory()
			fpath = dlg.GetPath()
			if not fpath.endswith(u'.bmp'):
				fpath+=u'.bmp'
			#Check if fpath already exists!?
			if os.path.isfile(fpath):
				dlgm = wx.MessageDialog(self, mtexts.txts['FileExists'], mtexts.txts['Message'], wx.YES_NO|wx.YES_DEFAULT|wx.ICON_QUESTION)
				if dlgm.ShowModal() == wx.ID_NO:
					dlgm.Destroy()#
					return
				dlgm.Destroy()#

			self.buffer.SaveFile(fpath, wx.BITMAP_TYPE_BMP)		
			self.fpathimgs = dpath

		dlg.Destroy()#


	def onSynastry(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if sys.platform == 'darwin':
			fpath = macfiledialog.choose_file(self.fpathhors)
			if fpath:
				dpath = os.path.dirname(fpath)
				if not fpath.lower().endswith(u'.hor'):
					fpath+=u'.hor'
				chrt = self.subLoad(fpath, dpath, True)
			else:
				chrt = None
			if chrt != None:
				txt = self.horoscope.name+u' - '+chrt.name+' '+mtexts.txts['Synastry']+' ('+str(chrt.time.origyear)+'.'+common.common.months[chrt.time.origmonth-1]+'.'+str(chrt.time.origday)+' '+str(chrt.time.hour)+':'+str(chrt.time.minute).zfill(2)+':'+str(chrt.time.second).zfill(2)+')'
				self._open_workspace_session(
					chrt, session_label=txt,
					radix=self.horoscope, view_mode=chart_session.ChartSession.COMPOUND,
				)
			return
		else:
			dlg = wx.FileDialog(self, mtexts.txts['OpenHor'], '', '', u'All files (*.*)|*.*', wx.FD_OPEN)
			if os.path.isdir(self.fpathhors):
				dlg.SetDirectory(self.fpathhors)
			else:
				dlg.SetDirectory(u'.')

		chrt = None
		if dlg.ShowModal() == wx.ID_OK:
			dpath = dlg.GetDirectory()
			fpath = dlg.GetPath()

			if not fpath.lower().endswith(u'.hor'):
				fpath+=u'.hor'

			chrt = self.subLoad(fpath, dpath, True)

		dlg.Destroy()#

		if chrt != None:
			txt = self.horoscope.name+u' - '+chrt.name+' '+mtexts.txts['Synastry']+' ('+str(chrt.time.origyear)+'.'+common.common.months[chrt.time.origmonth-1]+'.'+str(chrt.time.origday)+' '+str(chrt.time.hour)+':'+str(chrt.time.minute).zfill(2)+':'+str(chrt.time.second).zfill(2)+')'
			self._open_workspace_session(
				chrt, session_label=txt,
				radix=self.horoscope, view_mode=chart_session.ChartSession.COMPOUND,
			)


	def onFindTime(self, event):
		findtimdlg = findtimedlg.FindTimeDlg(self)
		findtimdlg.fill()
		findtimdlg.CenterOnParent()

#		findtimdlg.ShowModal() # because the "Calculating"-dialog will also be modal and it enables the Menues of the MainFrame!!
		findtimdlg.Show()


	def onEphemeris(self, event):
		ephemdlg = graphephemdlg.GraphEphemDlg(self)
		ephemdlg.CenterOnParent()
		val = ephemdlg.ShowModal()

		if val == wx.ID_OK:
			year = int(ephemdlg.year.GetValue())
			wait = wx.BusyCursor()
			eph = ephemcalc.EphemCalc(year, self.options)
			ephemfr = graphephemframe.GraphEphemFrame(self, mtexts.txts['Ephemeris'], year, eph.posArr, self.options)
			ephemfr.Show(True)


	def onClose(self, event):
		if self.dirty:
			dlgm = wx.MessageDialog(self, mtexts.txts['DiscardCurrHor'], mtexts.txts['Confirm'], wx.YES_NO|wx.ICON_QUESTION)
			if dlgm.ShowModal() == wx.ID_NO:
				dlgm.Destroy()#
				return
			dlgm.Destroy()#

		self.destroyDlgs()

		self.fpath = ''
		self.dirty = False
		self.splash = True
		self._workspace_state.reset()
		self._workspace_runtime = {}
		self.enableMenus(False)
		self.closeChildWnds()
		self.drawSplash()
		self.handleStatusBar(False)
		self.handleCaption(False)
		self._refresh_workspace_navigation()
		self.Refresh()	


	def onExit(self, event):
		# 1) 진행 중인 길게 도는 작업 중지 신호
		try:
			if hasattr(self, "abort") and self.abort:
				self.abort.aborting()
		except Exception:
			pass

		# 2) 타이머 정지
		try:
			if hasattr(self, "timer") and self.timer:
				self.timer.Stop()
				del self.timer
		except Exception:
			pass

		# 3) 프로그레스 다이얼로그 파괴
		try:
			if hasattr(self, "progbar") and self.progbar:
				self.progbar.Destroy()
				del self.progbar
		except Exception:
			pass

		if self.dirty:
			dlgm = wx.MessageDialog(self, mtexts.txts['DiscardCurrHor'], mtexts.txts['Confirm'], wx.YES_NO|wx.ICON_QUESTION)

			if dlgm.ShowModal() == wx.ID_NO:
				dlgm.Destroy()#
				return
			dlgm.Destroy()#

		self.destroyDlgs()
		try:
			del self.filehistory
		except Exception:
			pass

		# 6) 메인 프레임 파괴 → 메인루프 종료

		self.Destroy()


	def OnFileHistory(self, evt):
		if self.dirty:
			dlgm = wx.MessageDialog(self, mtexts.txts['DiscardCurrHor'], mtexts.txts['Confirm'], wx.YES_NO|wx.ICON_QUESTION)

			if dlgm.ShowModal() == wx.ID_NO:
				dlgm.Destroy()#
				return

			dlgm.Destroy()#

		# get the file based on the menu ID
		fileNum = evt.GetId()-wx.ID_FILE1
		path = self.filehistory.GetHistoryFile(fileNum)

		#check file
		if os.path.exists(path):
			self._open_workspace_chart_path(path)
		else:
			dlgm = wx.MessageDialog(self, mtexts.txts['FileError'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlgm.ShowModal()
			dlgm.Destroy()#
			self.filehistory.RemoveFileFromHistory(fileNum)


	def destroyDlgs(self):
		if self.trdatedlg != None:
			self.trdatedlg.Destroy()
			self.trdatedlg = None
		if self.trmondlg != None:
			self.trmondlg.Destroy()
			self.trmondlg = None
		if self.suntrdlg != None:
			self.suntrdlg.Destroy()
			self.suntrdlg = None
		if self.revdlg != None:
			self.revdlg.Destroy()
			self.revdlg = None
		if self.secdirdlg != None:
			self.secdirdlg.Destroy()
			self.secdirdlg = None
		if self.pdrangedlg != None:
			self.pdrangedlg.Destroy()
			self.pdrangedlg = None


	# --- Workspace-embedded table methods ---

	def _workspace_table_positions(self):
		if self.splash:
			return
		speculum = 0
		if self.options.primarydir == primdirs.PrimDirs.REGIOMONTAN:
			speculum = 1
		if not ((True in self.options.speculums[speculum]) or self.options.speculumdodecat[speculum]):
			dlgm = wx.MessageDialog(self, mtexts.txts['SelectColumn'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = positionswnd.PositionsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('positions', wnd)

	def _workspace_table_aspects(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = aspectswnd.AspectsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('aspects', wnd)

	def _workspace_table_rise_set(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = risesetwnd.RiseSetWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('rise_set', wnd)

	def _workspace_table_planetary_hours(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = hourswnd.HoursWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('planetary_hours', wnd)

	def _workspace_table_firdaria(self):
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = firdariawnd.FirdariaWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('firdaria', wnd)

	def _workspace_table_arabic_parts(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = arabicpartswnd.ArabicPartsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('arabic_parts', wnd)

	def _workspace_table_exact_transits(self):
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		if self.trmondlg is None:
			self.trmondlg = transitmdlg.TransitMonthDlg(None, self.horoscope.time)
		now = datetime.datetime.now()
		self.trmondlg.year.SetValue(str(now.year))
		self.trmondlg.month.SetValue(str(now.month))
		self.trmondlg.CenterOnParent()
		val = self.trmondlg.ShowModal()
		if val == wx.ID_OK:
			year = int(self.trmondlg.year.GetValue())
			month = int(self.trmondlg.month.GetValue())
			wait = wx.BusyCursor()
			trans = transits.Transits()
			trans.month(year, month, self.horoscope)
			host = self._workspace_shell.get_table_host()
			wnd = transitmwnd.TransitMonthWnd(host, trans.transits, year, month, self.horoscope, self.options, self)
			self._show_table_in_workspace('exact_transits', wnd)

	def _workspace_table_profections(self):
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		pdlg = proftabledlg.ProfTableDlg(self)
		pdlg.initialize()
		pdlg.CenterOnParent()
		val = pdlg.ShowModal()
		if val == wx.ID_OK:
			proftype = chart.Chart.YEAR
			mainsigs = pdlg.mainrb.GetValue()
			pchart = self.horoscope
			wait = wx.BusyCursor()
			y = self.horoscope.time.year
			m = self.horoscope.time.month
			d = self.horoscope.time.day
			t = self.horoscope.time.time
			if self.horoscope.time.month == 2 and self.horoscope.time.day == 29:
				d -= 1
			pcharts = []
			cyc = 0
			while cyc < 12:
				if self.options.zodprof:
					prof = profections.Profections(self.horoscope, y, m, d, t, cyc)
					pchart = chart.Chart(self.horoscope.name, self.horoscope.male, self.horoscope.time, self.horoscope.place, chart.Chart.PROFECTION, '', self.options, False, proftype)
					pchart.calcProfPos(prof)
				else:
					if not self.options.usezodprojsprof and (y+cyc == self.horoscope.time.year or (y+cyc-self.horoscope.time.year) % 12 == 0) and m == self.horoscope.time.month and d == self.horoscope.time.day:
						pchart = self.horoscope
					else:
						prof = munprofections.MunProfections(self.horoscope, y, m, d, t, cyc)
						proflondeg, proflonmin, proflonsec = util.decToDeg(prof.lonZ)
						profplace = chart.Place(mtexts.txts['Profections'], proflondeg, proflonmin, proflonsec, prof.east, self.horoscope.place.deglat, self.horoscope.place.minlat, self.horoscope.place.seclat, self.horoscope.place.north, self.horoscope.place.altitude)
						pchart = chart.Chart(self.horoscope.name, self.horoscope.male, self.horoscope.time, profplace, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
						pchartpls = chart.Chart(self.horoscope.name, self.horoscope.male, self.horoscope.time, self.horoscope.place, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
						pchart.planets.calcMundaneProfPos(pchart.houses.ascmc2, pchartpls.planets.planets, self.horoscope.place.lat, self.horoscope.obl[0])
						pchart.fortune.calcMundaneProfPos(pchart.houses.ascmc2, pchartpls.fortune, self.horoscope.place.lat, self.horoscope.obl[0])
				pcharts.append((pchart, y+cyc, m, d, t))
				cyc += 1
			host = self._workspace_shell.get_table_host()
			wnd = profectionswnd.ProfectionsWnd(host, 0, pcharts, self.options, self, mainsigs)
			self._show_table_in_workspace('profections_table', wnd)
		pdlg.Destroy()

	def _workspace_table_primary_dirs(self):
		self._pd_for_workspace = True
		self.onPrimaryDirs(None)

	def _workspace_table_misc(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = miscwnd.MiscWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('misc', wnd)

	def _workspace_table_midpoints(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = midpointswnd.MidPointsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('midpoints', wnd)

	def _workspace_table_speeds(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = speedswnd.SpeedsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('speeds', wnd)

	def _workspace_table_mundane_positions(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = munposwnd.MunPosWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('mundane_positions', wnd)

	def _workspace_table_antiscia(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = antisciawnd.AntisciaWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('antiscia', wnd)

	def _workspace_table_zodpars(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = zodparswnd.ZodParsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('zodpars', wnd)

	def _workspace_table_strip(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = stripwnd.StripWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('strip', wnd)

	def _workspace_table_almuten_zodiacal(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = almutenzodswnd.AlmutenZodsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('almuten_zodiacal', wnd)

	def _workspace_table_almuten_chart(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = almutenchartwnd.AlmutenChartWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('almuten_chart', wnd)

	def _workspace_table_fixed_stars(self):
		if self.splash:
			return
		if not self.checkFixStars():
			return
		if len(self.options.fixstars) == 0:
			dlgm = wx.MessageDialog(self, mtexts.txts['NoSelFixStars'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = fixstarswnd.FixStarsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('fixed_stars', wnd)

	def _workspace_table_fixed_stars_aspects(self):
		if self.splash:
			return
		if not self.checkFixStars():
			return
		if len(self.options.fixstars) == 0:
			dlgm = wx.MessageDialog(self, mtexts.txts['NoSelFixStars'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = fixstarsaspectswnd.FixStarsAspectsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('fixed_stars_aspects', wnd)

	def _workspace_table_fixed_stars_parallels(self):
		if self.splash:
			return
		if not self.checkFixStars():
			return
		if len(self.options.fixstars) == 0:
			dlgm = wx.MessageDialog(self, mtexts.txts['NoSelFixStars'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = fixstarsparallelswnd.FixStarsParallelsWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('fixed_stars_parallels', wnd)

	def _workspace_table_eclipses(self):
		if self.splash:
			return
		if self.horoscope is None:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = eclipseswnd.EclipsesWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('eclipses', wnd)

	def _workspace_table_angle_at_birth(self):
		if self.splash:
			return
		if self.horoscope is None:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = angleatbirthwnd.AngleAtBirthWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('angle_at_birth', wnd)

	def _workspace_open_circumambulation(self):
		if self.splash:
			return
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		wait = wx.BusyCursor()
		try:
			host = self._workspace_shell.get_table_host()
			wnd = circumambulationframe.CircumWnd(host, self.horoscope, self.options, mainfr=self)
			rows = circumambulation.compute_distributions(
				self.horoscope, self.options,
				key=circumambulationframe._circum_years_per_deg_from_options(self.options),
				max_rows=60, include_participating=True, max_age_years=150,
				use_exact_oa=circumambulation.use_pd_circumoa_from_options(self.options)
			)
			wnd.set_data(rows)
			self._show_table_in_workspace('circumambulation', wnd)
		except ValueError as e:
			wx.MessageBox(u"%s" % e, mtexts.txts['Circumambulation'], wx.OK | wx.ICON_INFORMATION)
		finally:
			del wait

	def _workspace_table_zodiacal_releasing(self):
		if self.splash:
			return
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = zodiacalreleasingwnd.ZRWnd(host, self.horoscope, self.options, mainfr=self)
		wnd.compute_and_draw()
		self._show_table_in_workspace('zodiacal_releasing', wnd)
		del wait

	def _workspace_table_decennials(self):
		if self.splash:
			return
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = decennialswnd.DecWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('decennials', wnd)

	def _workspace_table_phasis(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = phasiswnd.PhasisWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('phasis', wnd)

	def _workspace_table_paranatellonta(self):
		if self.splash:
			return
		wait = wx.BusyCursor()
		host = self._workspace_shell.get_table_host()
		wnd = paranwnd.ParanatellontaWnd(host, self.horoscope, self.options, self)
		self._show_table_in_workspace('paranatellonta', wnd)

	# --- end workspace-embedded table methods ---

	#Table-menu
	def onPositions(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			speculum = 0
			if self.options.primarydir == primdirs.PrimDirs.REGIOMONTAN:
				speculum = 1
			if (True in self.options.speculums[speculum]) or self.options.speculumdodecat[speculum]:
				wait = wx.BusyCursor()
				posframe = positionsframe.PositionsFrame(self, self.title, self.horoscope, self.options)
				posframe.Show(True)
			else:
				dlgm = wx.MessageDialog(self, mtexts.txts['SelectColumn'], '', wx.OK|wx.ICON_INFORMATION)
				dlgm.ShowModal()
				dlgm.Destroy()#


	def onAlmutenZodiacal(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			almutenfr = almutenzodsframe.AlmutenZodsFrame(self, self.title, self.horoscope, self.options)
			almutenfr.Show(True)


	def onAlmutenChart(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			almutenfr = almutenchartframe.AlmutenChartFrame(self, self.title, self.horoscope, self.options)
			almutenfr.Show(True)


	def onAlmutenTopical(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			if self.horoscope.options.topicals != None and len(self.horoscope.almutens.topicals.names) != 0:
				wait = wx.BusyCursor()
				topicalframe = almutentopicalsframe.AlmutenTopicalsFrame(self, self.horoscope, self.title)
				topicalframe.Show(True)
			else:
				dlgm = wx.MessageDialog(self, mtexts.txts['NoTopicalsCreated'], '', wx.OK|wx.ICON_INFORMATION)
				dlgm.ShowModal()
				dlgm.Destroy()#


	def onMisc(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			tblframe = miscframe.MiscFrame(self, self.title, self.horoscope, self.options)
			tblframe.Show(True)


	def onAspects(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			aspsframe = aspectsframe.AspectsFrame(self, self.title, self.horoscope, self.options)
			aspsframe.Show(True)


	def onMidpoints(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			midsframe = midpointsframe.MidPointsFrame(self, self.title, self.horoscope, self.options)
			midsframe.Show(True)


	def onRiseSet(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			risesetfr = risesetframe.RiseSetFrame(self, self.title, self.horoscope, self.options)
			risesetfr.Show(True)


	def onSpeeds(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			speedsfr = speedsframe.SpeedsFrame(self, self.title, self.horoscope, self.options)
			speedsfr.Show(True)


	def onMunPos(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			munposfr = munposframe.MunPosFrame(self, self.title, self.horoscope, self.options)
			munposfr.Show(True)


	def onAntiscia(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			antisciafr = antisciaframe.AntisciaFrame(self, self.title, self.horoscope, self.options)
			antisciafr.Show(True)

# ###################################
# Elias change v 8.0.0
#	def onDodecatemoria(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
#		if wx.Platform == '__WXMSW__' and not self.splash:
#			self.handleStatusBar(True)

#		if not self.splash:
#			wait = wx.BusyCursor()
#			dodecatemoriafr = dodecatemoriaframe.DodecatemoriaFrame(self, self.title, self.horoscope, self.options)
#			dodecatemoriafr.Show(True)
# ###################################      

	def onZodPars(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			zodparsfr = zodparsframe.ZodParsFrame(self, self.title, self.horoscope, self.options)
			zodparsfr.Show(True)


	def onStrip(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			stripfr = stripframe.StripFrame(self, self.title, self.horoscope, self.options)
			stripfr.Show(True)


	def onFixStars(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			if not self.checkFixStars():
				return

			if len(self.options.fixstars) == 0:
				dlgm = wx.MessageDialog(self, mtexts.txts['NoSelFixStars'], '', wx.OK|wx.ICON_INFORMATION)
				dlgm.ShowModal()
				dlgm.Destroy()
				return	

			wait = wx.BusyCursor()
			fixstarsfr = fixstarsframe.FixStarsFrame(self, self.title, self.horoscope, self.options)
			fixstarsfr.Show(True)


	def onFixStarsAsps(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			if not self.checkFixStars():
				return

			if len(self.options.fixstars) == 0:
				dlgm = wx.MessageDialog(self, mtexts.txts['NoSelFixStars'], '', wx.OK|wx.ICON_INFORMATION)
				dlgm.ShowModal()
				dlgm.Destroy()
				return	

			wait = wx.BusyCursor()
			fixstarsaspsfr = fixstarsaspectsframe.FixStarsAspectsFrame(self, self.title, self.horoscope, self.options)
			fixstarsaspsfr.Show(True)

	def onFixStarsParallels(self, event):
		# Windows에서 가속키 사용 시 EVT_MENU_CLOSE가 누락되는 케이스 정합
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			if not self.checkFixStars():
				return
			if len(self.options.fixstars) == 0:
				dlgm = wx.MessageDialog(self, mtexts.txts['NoSelFixStars'], '', wx.OK|wx.ICON_INFORMATION)
				dlgm.ShowModal()
				dlgm.Destroy()
				return

			wait = wx.BusyCursor()
			fr = fixstarsparallelsframe.FixStarsParallelsFrame(self, self.title, self.horoscope, self.options)
			fr.Show(True)

	def onPlanetaryHours(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			planetaryfr = hoursframe.HoursFrame(self, self.title, self.horoscope, self.options)
			planetaryfr.Show(True)


	def onArabians(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			partsfr = arabicpartsframe.ArabicPartsFrame(self, self.title, self.horoscope, self.options)
			partsfr.Show(True)


	def onExactTransits(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		if self.trmondlg == None:
			self.trmondlg = transitmdlg.TransitMonthDlg(None, self.horoscope.time)
		now = datetime.datetime.now()
		self.trmondlg.year.SetValue(str(now.year))
		self.trmondlg.month.SetValue(str(now.month))
		self.trmondlg.CenterOnParent()
		val = self.trmondlg.ShowModal()

		if val == wx.ID_OK:	
			year = int(self.trmondlg.year.GetValue())
			month = int(self.trmondlg.month.GetValue())

			wait = wx.BusyCursor()

			trans = transits.Transits()
			trans.month(year, month, self.horoscope)
			tw = transitmframe.TransitMonthFrame(self, self.title.replace(mtexts.typeList[self.horoscope.htype], mtexts.txts['Transit']+' ('+str(year)+'.'+common.common.months[month-1]+')'), trans.transits, year, month, self.horoscope, self.options)
			tw.Show(True)

	def onSearchModule(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			searchfr = searchframe.SearchFrame(self, self.title, self.horoscope, self.options)
			searchfr.Show(True)

	def onAngleAtBirth(self, event):
		# Windows에서 단축키로 열었을 때 상태바 처리(기존 패턴과 동일)
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		# 차트 없으면 비활성 메시지
		if self.horoscope is None:
			wx.MessageBox(u"차트가 없습니다.", mtexts.txts["AngleatBirth"])
			return

		# 열기
		import angleatbirthframe
		fr = angleatbirthframe.AngleAtBirthFrame(self, self.title, self.horoscope, self.options)

	def onProfections(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		pdlg = proftabledlg.ProfTableDlg(self)
		pdlg.initialize()

		pdlg.CenterOnParent()

		val = pdlg.ShowModal()
		if val == wx.ID_OK:
			proftype = chart.Chart.YEAR
			mainsigs = pdlg.mainrb.GetValue()

			pchart = self.horoscope

			wait = wx.BusyCursor()

			#Cycle
			y = self.horoscope.time.year
			m = self.horoscope.time.month
			d = self.horoscope.time.day
			t = self.horoscope.time.time

			#Feb29?
			if self.horoscope.time.month == 2 and self.horoscope.time.day == 29:
				d -= 1

			pcharts = []

			cyc = 0
			while(cyc < 12):
				if self.options.zodprof:
					prof = profections.Profections(self.horoscope, y, m, d, t, cyc)
					pchart = chart.Chart(self.horoscope.name, self.horoscope.male, self.horoscope.time, self.horoscope.place, chart.Chart.PROFECTION, '', self.options, False, proftype)
					pchart.calcProfPos(prof)
				else:
					if not self.options.usezodprojsprof and (y+cyc == self.horoscope.time.year or (y+cyc-self.horoscope.time.year) % 12 == 0) and m == self.horoscope.time.month and d == self.horoscope.time.day:
						pchart = self.horoscope
					else:
						prof = munprofections.MunProfections(self.horoscope, y, m, d, t, cyc)
						proflondeg, proflonmin, proflonsec = util.decToDeg(prof.lonZ)
						profplace = chart.Place(mtexts.txts['Profections'], proflondeg, proflonmin, proflonsec, prof.east, self.horoscope.place.deglat, self.horoscope.place.minlat, self.horoscope.place.seclat, self.horoscope.place.north, self.horoscope.place.altitude)
						pchart = chart.Chart(self.horoscope.name, self.horoscope.male, self.horoscope.time, profplace, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
						pchartpls = chart.Chart(self.horoscope.name, self.horoscope.male, self.horoscope.time, self.horoscope.place, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
						#modify planets, ...
						pchart.planets.calcMundaneProfPos(pchart.houses.ascmc2, pchartpls.planets.planets, self.horoscope.place.lat, self.horoscope.obl[0])
	
						#modify lof
						pchart.fortune.calcMundaneProfPos(pchart.houses.ascmc2, pchartpls.fortune, self.horoscope.place.lat, self.horoscope.obl[0])
	
				pcharts.append((pchart, y+cyc, m, d, t))
				cyc += 1

			profsfr = profstableframe.ProfsTableFrame(self, self.title, pcharts, self.options, mainsigs)
			profsfr.Show(True)

			pstepdlg = profectiontablestepperdlg.ProfectionTableStepperDlg(profsfr, self.horoscope, self.options, proftype)
			pstepdlg.CenterOnParent()
			pstepdlg.Show(True)

		pdlg.Destroy()


	def onCustomerSpeculum(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			speculum = 0
			if self.options.primarydir == primdirs.PrimDirs.REGIOMONTAN:
				speculum = 1
			if (True in self.options.speculums[speculum]) or self.options.speculumdodecat[speculum]:
					if self.horoscope.cpd != None:
						wait = wx.BusyCursor()
						custframe = customerframe.CustomerFrame(self, self.title, self.horoscope, self.options, self.horoscope.cpd)
						custframe.Show(True)
					elif self.horoscope.cpd2 != None:
						wait = wx.BusyCursor()
						custframe = customerframe.CustomerFrame(self, self.title, self.horoscope, self.options, self.horoscope.cpd2)
						custframe.Show(True)
					else:
						dlgm = wx.MessageDialog(self, mtexts.txts['CheckUser'], '', wx.OK|wx.ICON_INFORMATION)
						dlgm.ShowModal()
						dlgm.Destroy()#
			else:
				dlgm = wx.MessageDialog(self, mtexts.txts['SelectColumn'], '', wx.OK|wx.ICON_INFORMATION)
				dlgm.ShowModal()
				dlgm.Destroy()#

# ###########################################
# Roberto change  V 7.3.0
	def onFirdaria(self, event):
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal(); dlgm.Destroy(); return
		if not self.splash:
			wait = wx.BusyCursor()
			firdfr = firdariaframe.FirdariaFrame(self, self.title, self.horoscope, self.options)
			firdfr.Show(True)
# ###########################################

# ###################################
# Roberto change v 8.0.1
	#def onDodecatemoria(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		#if wx.Platform == '__WXMSW__' and not self.splash:
			#self.handleStatusBar(True)
	
		#if not self.splash:
			#wait = wx.BusyCursor()
			#dodecatemoriafr = dodecatemoriaframe.DodecatemoriaFrame(self, self.title, self.horoscope, self.options)
			#dodecatemoriafr.Show(True)
# ###################################
	def onDodecatemoria(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			wait = wx.BusyCursor()
			try:
				# 1) 기존 도데카테모리온 창
				dodeca_table_fr = dodecatemoriaframe.DodecatemoriaFrame(self, self.title, self.horoscope, self.options)
				dodeca_table_fr.Show(True)

				# 2) 새 도데카테모리온 계산기 창
				#    - 새 텍스트 키 추가 없이, 기존 키를 재사용
				calc_title = self.title.replace(
					mtexts.typeList[self.horoscope.htype],
					mtexts.txts.get('Dodecatemorion', 'Dodecatemoria')
				)
				dodeca_calc_fr = dodecacalcframe.DodecaCalcFrame(self, calc_title, self.horoscope, self.options)
				dodeca_calc_fr.Show(True)
			finally:
				del wait

	def onCircumambulation(self, event):
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal(); dlgm.Destroy(); return
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)
		if not self.splash:
			wait = wx.BusyCursor()
			try:
				import circumambulationframe
				fr = circumambulationframe.CircumFrame(self, self.title, self.horoscope, self.options)
				fr.Show(True)
			finally:
				del wait

	def onFixStarAngleDirs(self, event):
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal(); dlgm.Destroy(); return
		# Windows 가속키 사용 시 상태바 처리(프로그램 기존 관례)
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.splash:
			# 고정별 카탈로그/선택 검증 (onFixStars 로직과 동일)
			if not self.checkFixStars():
				return
			if len(self.options.fixstars) == 0:
				dlgm = wx.MessageDialog(self, mtexts.txts['NoSelFixStars'], '', wx.OK|wx.ICON_INFORMATION)
				dlgm.ShowModal(); dlgm.Destroy(); return

			# >>> PD 범위/방향 팝업 재사용 <<<
			if self.pdrangedlg == None:
				self.pdrangedlg = primdirsrangedlg.PrimDirsRangeDlg(None)
			self.pdrangedlg.CenterOnParent()
			val = self.pdrangedlg.ShowModal()
			if val != wx.ID_OK:
				return

			# PD와 동일하게 범위/방향 읽기
			pdrange = primdirs.PrimDirs.RANGEALL
			if self.pdrangedlg.range25rb.GetValue():
				pdrange = primdirs.PrimDirs.RANGE25
			elif self.pdrangedlg.range50rb.GetValue():
				pdrange = primdirs.PrimDirs.RANGE50
			elif self.pdrangedlg.range75rb.GetValue():
				pdrange = primdirs.PrimDirs.RANGE75
			elif self.pdrangedlg.range100rb.GetValue():
				pdrange = primdirs.PrimDirs.RANGE100

			direction = primdirs.PrimDirs.BOTHDC
			if self.pdrangedlg.directrb.GetValue():
				direction = primdirs.PrimDirs.DIRECT
			elif self.pdrangedlg.converserb.GetValue():
				direction = primdirs.PrimDirs.CONVERSE

			wait = wx.BusyCursor()
			try:
				# pdrange, direction을 프레임에 전달
				fr = fixstardirsframe.FixedStarDirsFrame(self, self.title, self.horoscope, self.options, pdrange, direction)
				fr.Show(True)
			finally:
				del wait

	def onEclipses(self, event):
		if self.horoscope is None:
			return
		fr = eclipsesframe.EclipsesFrame(self, self.title, self.horoscope, self.options)
		fr.Show(True)

	def onZodiacalReleasing(self, event):
		if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
			self._workspace_table_zodiacal_releasing()
			return
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal(); dlgm.Destroy(); return
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)
		if not self.splash:
			import zodiacalreleasingframe
			fr = zodiacalreleasingframe.ZRFrame(self, self.title, self.horoscope, self.options)
	def onDecennials(self, event):
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal(); dlgm.Destroy(); return
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)
		if not self.splash:
			wait = wx.BusyCursor()
			try:
				import decennialsframe
				fr = decennialsframe.DecennialsFrame(self, self.title, self.horoscope, self.options)
				#fr.Show(True)
			finally:
				del wait

	def onPhasis(self, event):
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)
		if not self.splash:
			wait = wx.BusyCursor()
			try:
				import phasisframe
				fr = phasisframe.PhasisFrame(self, self.title, self.horoscope, self.options)
				fr.Show(True)
			finally:
				del wait

	def onParanatellonta(self, event):
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)
		if not self.splash:
			wait = wx.BusyCursor()
			try:
				import paranframe
				fr = paranframe.ParanFrame(self, self.title, self.horoscope, self.options)
				fr.Show(True)
			finally:
				del wait

	def onPrimaryDirs(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.horoscope.time.bc:
			self._pd_for_workspace = False
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		if self.pdrangedlg == None:
			self.pdrangedlg = primdirsrangedlg.PrimDirsRangeDlg(None)

		self.pdrangedlg.CenterOnParent()

		val = self.pdrangedlg.ShowModal()
		if val != wx.ID_OK:
			self._pd_for_workspace = False
		if val == wx.ID_OK:
			pdrange = primdirs.PrimDirs.RANGEALL
			if self.pdrangedlg.range25rb.GetValue():
				pdrange = primdirs.PrimDirs.RANGE25
			elif self.pdrangedlg.range50rb.GetValue():
				pdrange = primdirs.PrimDirs.RANGE50
			elif self.pdrangedlg.range75rb.GetValue():
				pdrange = primdirs.PrimDirs.RANGE75
			elif self.pdrangedlg.range100rb.GetValue():
				pdrange = primdirs.PrimDirs.RANGE100

			direction = primdirs.PrimDirs.BOTHDC
			if self.pdrangedlg.directrb.GetValue():
				direction = primdirs.PrimDirs.DIRECT
			elif self.pdrangedlg.converserb.GetValue():
				direction = primdirs.PrimDirs.CONVERSE

			keytxt = ''
			if self.options.pdkeydyn:
				keytxt = mtexts.typeListDyn[self.options.pdkeyd]
			else:
				keytxt = mtexts.typeListStat[self.options.pdkeys]

			txt = mtexts.typeListDirs[self.options.primarydir]+'; '+keytxt+'\n'+mtexts.txts['BusyInfo']

			self.progbar = wx.ProgressDialog(mtexts.txts['Calculating'], txt, parent=self, style = wx.PD_CAN_ABORT|wx.PD_APP_MODAL)
			self.progbar.Fit()

			self.pds = None
			self.pdready = False
			self.abort = primdirs.AbortPD()
			thId = _thread.start_new_thread(self.calcPDs, (pdrange, direction, self))

			self.timer = wx.Timer(self)
			self.Bind(wx.EVT_TIMER, self.OnTimer)
			self.timer.Start(500)


	def calcPDs(self, pdrange, direction, win):
		if self.options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC:
			self.pds = placidiansapd.PlacidianSAPD(self.horoscope, self.options, pdrange, direction, self.abort)
		elif self.options.primarydir == primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE:
			self.pds = placidianutppd.PlacidianUTPPD(self.horoscope, self.options, pdrange, direction, self.abort)
		elif self.options.primarydir == primdirs.PrimDirs.REGIOMONTAN:
			self.pds = regiomontanpd.RegiomontanPD(self.horoscope, self.options, pdrange, direction, self.abort)
		else:
			self.pds = campanianpd.CampanianPD(self.horoscope, self.options, pdrange, direction, self.abort)

		pdlock.acquire()
		self.pdready = True
		pdlock.release()
		evt = PDReadyEvent()
		wx.PostEvent(win, evt)


	def OnTimer(self, event):
		pdlock.acquire()
		if not self.pdready:
			(keepGoing, skip) = self.progbar.Pulse()

			if not keepGoing:
				self.abort.aborting()
		pdlock.release()


	def OnPDReady(self, event):
		self.timer.Stop()
		del self.timer
		self.progbar.Destroy()
		del self.progbar

		use_workspace = self._pd_for_workspace
		self._pd_for_workspace = False

		if self.abort.abort:
			self.Refresh()
		else:
			if self.pds != None and len(self.pds.pds) > 0:
				if use_workspace and hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
					LINE_NUM = 40
					PAGE = LINE_NUM * 2
					pdsmaxnum = len(self.pds.pds)
					remainder = pdsmaxnum % PAGE
					addition = 1 if remainder > 0 else 0
					maxpage = int(pdsmaxnum / PAGE) + addition
					fr = 0
					to = min(PAGE, len(self.pds.pds))
					host = self._workspace_shell.get_table_host()
					wnd = primdirslistwnd.PrimDirsListWnd(host, self.horoscope, self.options, self.pds, self, 1, maxpage, fr, to)
					self._show_table_in_workspace('primary_directions', wnd)
				else:
					pdw = primdirslistframe.PrimDirsListFrame(self, self.horoscope, self.options, self.pds, self.title.replace(mtexts.typeList[self.horoscope.htype], mtexts.txts['PrimaryDirs']))
					pdw.Show(True)
			else:
				dlgm = wx.MessageDialog(self, mtexts.txts['NoPDsWithSettings'], mtexts.txts['Information'], wx.OK|wx.ICON_INFORMATION)
				dlgm.ShowModal()
				dlgm.Destroy()#

		if self.pds != None:
			del self.pds

		del self.abort


	#Charts-menu
	def onTransits(self, event):
		radix = self._active_radix_chart()
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if radix.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		if not self._should_prompt_quickcharts():
			self._open_current_transits()
			return

		if self.trdatedlg == None:
			self.trdatedlg = timespacedlg.TimeSpaceDlg(None, mtexts.txts['Transits'], self.options.langid)
		self.trdatedlg.initialize(radix)
		self.trdatedlg.CenterOnParent()

		val = self.trdatedlg.ShowModal()
		if val == wx.ID_OK:	
			wait = wx.BusyCursor()

			direc = self.trdatedlg.placerbE.GetValue()
			hemis = self.trdatedlg.placerbN.GetValue()
			place = chart.Place(self.trdatedlg.birthplace.GetValue(), int(self.trdatedlg.londeg.GetValue()), int(self.trdatedlg.lonmin.GetValue()), 0, direc, int(self.trdatedlg.latdeg.GetValue()), int(self.trdatedlg.latmin.GetValue()), 0, hemis, 0) #Transit doesn't calculate planetary hours => altitude is zero

			time = self._chart_time_from_dialog(self.trdatedlg, place, False)

			trans = chart.Chart(radix.name, radix.male, time, place, chart.Chart.TRANSIT, '', self.options, False)

			label = self._workspace_timed_label(mtexts.typeList[chart.Chart.TRANSIT], time.year, time.month, time.day, time.hour, time.minute)
			self._open_workspace_session(
				trans, session_label=label,
				radix=radix, view_mode=chart_session.ChartSession.COMPOUND,
				navigation_units=('day', 'hour', 'minute'),
				navigation_title_label=mtexts.typeList[chart.Chart.TRANSIT],
				display_datetime=(time.year, time.month, time.day, time.hour, time.minute, time.second),
			)


	def onRevolutions(self, event):
		radix = self._active_radix_chart()
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if radix.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		if self.revdlg == None:
			# 메인 프레임(self)을 parent로
			self.revdlg = revolutionsdlg.RevolutionsDlg(self)
		self.revdlg.initialize(radix)
		self.revdlg.CenterOnParent()
		try:
			val = self.revdlg.ShowModal()
			if val != wx.ID_OK:
				return
			if self.revdlg.typecb.GetCurrentSelection() == revolutions.Revolutions.SOLAR:
				wx.BeginBusyCursor()
				try:
					self._open_configured_solar_revolution()
				finally:
					if wx.IsBusy():
						wx.EndBusyCursor()
				return
			if val == wx.ID_OK:
				wx.BeginBusyCursor()
				revs = revolutions.Revolutions()
				result = revs.compute(self.revdlg.typecb.GetCurrentSelection(),
									int(self.revdlg.year.GetValue()),
									int(self.revdlg.month.GetValue()),
									int(self.revdlg.day.GetValue()),
									radix)
				wx.EndBusyCursor()

				t1, t2, t3, t4, t5, t6 = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]
				if result:
					if self.options.ayanamsha != 0:
						sel = self.revdlg.typecb.GetCurrentSelection()
						pid = None
						if sel == revolutions.Revolutions.SOLAR:
							pid = astrology.SE_SUN
						elif sel == revolutions.Revolutions.LUNAR:
							pid = astrology.SE_MOON
						elif sel == revolutions.Revolutions.MERCURY:
							pid = astrology.SE_MERCURY
						elif sel == revolutions.Revolutions.VENUS:
							pid = astrology.SE_VENUS
						elif sel == revolutions.Revolutions.MARS:
							pid = astrology.SE_MARS
						elif sel == revolutions.Revolutions.JUPITER:
							pid = astrology.SE_JUPITER
						elif sel == revolutions.Revolutions.SATURN:
							pid = astrology.SE_SATURN

						if pid is not None:
							t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, pid)

					ti = (t1, t2, t3, t4, t5, t6, chart.Time.GREGORIAN, chart.Time.GREENWICH, 0, 0)
					place = radix.place
					plus = True
					dlg = None
					if getattr(self.options, 'revolutions_planetslocationmode', 0) == 1:
						dlg = timespacedlg.TimeSpaceDlg(self, mtexts.txts['Revolutions'], self.options.langid)
						dlg.initialize(radix, ti)
						dlg.CenterOnParent()
						if dlg.ShowModal() != wx.ID_OK:
							dlg.Destroy()
							return
						direc = dlg.placerbE.GetValue()
						hemis = dlg.placerbN.GetValue()
						place = chart.Place(dlg.birthplace.GetValue(), int(dlg.londeg.GetValue()), int(dlg.lonmin.GetValue()), 0, direc, int(dlg.latdeg.GetValue()), int(dlg.latmin.GetValue()), 0, hemis, 0)
						if dlg.pluscb.GetCurrentSelection() == 1:
							plus = False
						dlg.Destroy()
					if self.options.ayanamsha != 0 and pid is not None:
						try:
							t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(
								revs, pid,
								topo_place=place,
								seed=(t1, t2, t3, t4, t5, t6)
							)
						except Exception:
							pass
					if True:
						wait = wx.BusyCursor()
						revtype = chart.Chart.REVOLUTION
						if self.revdlg.typecb.GetCurrentSelection() == 0:
							revtype = chart.Chart.SOLAR
						elif self.revdlg.typecb.GetCurrentSelection() == 1:
							revtype = chart.Chart.LUNAR
						time = chart.Time(t1, t2, t3, t4, t5, t6, False, radix.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)

						revolution = chart.Chart(radix.name, radix.male, time, place, revtype, '', self.options, False)
						rev_label = self._workspace_timed_label(mtexts.typeList[revtype], time.year, time.month, time.day, time.hour, time.minute)
						self._open_workspace_session(
							revolution, session_label=rev_label,
							radix=radix, view_mode=chart_session.ChartSession.CHART,
							display_datetime=(time.year, time.month, time.day, time.hour, time.minute, time.second),
						)
						self._rev_ctx   = {'place': place, 'plus': plus, 'revtype': revtype}

						# 이전에 떠 있던 스텝퍼가 있으면 닫기(다른 리턴일 수도 있으니 먼저 정리)
						try:
							if hasattr(self, "_rev_stepper") and self._rev_stepper:
								self._rev_stepper.Destroy()
								self._rev_stepper = None
						except Exception:
							pass

						# ★ 솔라 리턴에서만 스텝퍼를 띄운다
						if self.revdlg.typecb.GetCurrentSelection() == revolutions.Revolutions.SOLAR:
							self._install_workspace_solar_revolution_stepper(place, plus, t1)
						# ★ 루나 리턴에도 월 스텝퍼를 붙인다
						# SOLAR 분기 밑에 이어서:
						elif self.revdlg.typecb.GetCurrentSelection() == revolutions.Revolutions.LUNAR:

							# 1) 다이얼로그에서 고른 시작 날짜를 기억(월만 바꿔가며 재계산)
							self._lr_year  = int(self.revdlg.year.GetValue())
							self._lr_month = int(self.revdlg.month.GetValue())
							self._lr_day   = int(self.revdlg.day.GetValue())

							# 리턴 프레임이 닫히면 스텝퍼도 함께 닫기
							def _on_close(evt):
								try:
									if hasattr(self, "_rev_stepper") and self._rev_stepper:
										self._rev_stepper.Destroy()
										self._rev_stepper = None
								except Exception:
									pass
								evt.Skip()
							if hasattr(self, '_rev_frame') and self._rev_frame is not None:
								self._rev_frame.Bind(wx.EVT_CLOSE, _on_close)

							# 2) (yy, mm)로 루나 리턴 재계산 후 프레임 갱신
							def _set_lr_ym_and_refresh(yy, mm):
								revs2 = revolutions.Revolutions()

								# 31→2월 같은 불가능한 날짜 보정
								dd = int(self._lr_day)
								try:
									while not util.checkDate(int(yy), int(mm), int(dd)) and dd > 1:
										dd -= 1
								except Exception:
									pass

								ok = revs2.compute(revolutions.Revolutions.LUNAR,
												int(yy), int(mm), int(dd), radix)
								if not ok:
									return

								y, m, d, hh, mi, ss = revs2.t[0], revs2.t[1], revs2.t[2], revs2.t[3], revs2.t[4], revs2.t[5]
								try:
									if self.options.ayanamsha != 0:
										y, m, d, hh, mi, ss = self.calcPrecNutCorrectedRevolution(revs2, astrology.SE_MOON)
								except Exception:
									pass
								time2 = chart.Time(y, m, d, hh, mi, ss, False,
												radix.time.cal, chart.Time.GREENWICH,
												self._rev_ctx['plus'], 0, 0, False, self._rev_ctx['place'], False)
								chart2 = chart.Chart(radix.name, radix.male, time2,
													self._rev_ctx['place'], self._rev_ctx['revtype'], '', self.options, False)

								active_cs = self._active_chart_session()
								if active_cs is not None:
									active_cs.change_chart(
										chart2,
										display_datetime=(time2.year, time2.month, time2.day, time2.hour, time2.minute, time2.second),
									)
									return

								newtitle2 = self.title.replace(
									mtexts.typeList[self.horoscope.htype],
									mtexts.typeList[self._rev_ctx['revtype']]+' ('+str(time2.year)+'.'
									+ common.common.months[time2.month-1]+'.'+str(time2.day)+' '
									+ str(time2.hour)+':'+str(time2.minute).zfill(2)+':'+str(time2.second).zfill(2)+'('
									+ mtexts.txts['GMT']+'))'
								)

								try:
									# 일부 빌드에선 이 메서드가 없습니다(당신 케이스).
									self._rev_frame.change_chart(chart2)
									self._rev_frame.SetTitle(newtitle2)
									wx.CallAfter(self._rev_frame.Raise)
									wx.CallAfter(self._rev_frame.SetFocus)
								except Exception:
									# ★ 폴백: 기존 프레임을 안전하게 닫고 새로 띄웁니다(솔라와 동일 패턴).
									try:
										self._rev_frame.Destroy()
									except Exception:
										pass

									# 새 리턴 프레임 오픈
									self._rev_frame = transitframe.TransitFrame(self, newtitle2, chart2, radix, self.options)
									self._rev_frame._stepper = self._rev_stepper
									self._rev_frame.Show(True)
									wx.CallAfter(self._rev_frame.Raise)
									wx.CallAfter(self._rev_frame.SetFocus)

									# 리턴 프레임이 닫히면 스텝퍼도 같이 닫히도록(이미 위에서 정의한 핸들러)
									self._rev_frame.Bind(wx.EVT_CLOSE, _on_close)

							# 3) 스텝퍼에 현재값/설정 콜백 연결
							def _get_lr_ym():
								return (self._lr_year, self._lr_month)

							def _set_lr_ym(yy, mm):
								self._lr_year, self._lr_month = int(yy), int(mm)
								_set_lr_ym_and_refresh(self._lr_year, self._lr_month)

							from revolutionsdlg import RevolutionMonthStepper  # 있어도 무방, 없으면 추가
							self._rev_stepper = RevolutionMonthStepper(
								parent=self,            # ★ 메인 프레임을 부모로!
								get_ym_cb=_get_lr_ym,
								set_ym_cb=_set_lr_ym,
							)
							cs = self._active_chart_session()
							if cs is not None:
								cs._stepper = self._rev_stepper
							self.handleStatusBar(True)
							self.handleCaption(True)
							if hasattr(self, '_rev_frame') and self._rev_frame is not None:
								self._rev_frame._stepper = self._rev_stepper
							if ENABLE_LUNAR_POPUP_STEPPER:
								self._rev_stepper.Show(True)
								try:
									self._rev_stepper.CentreOnScreen()
								except Exception:
									self._rev_stepper.CenterOnScreen()
								self._rev_stepper.Raise()
							else:
								self._rev_stepper.Show(False)

						elif self.revdlg.typecb.GetCurrentSelection() in (
								revolutions.Revolutions.MERCURY, revolutions.Revolutions.VENUS,
								revolutions.Revolutions.MARS, revolutions.Revolutions.JUPITER,
								revolutions.Revolutions.SATURN):
							_planet_sel = self.revdlg.typecb.GetCurrentSelection()
							_planet_pid_map = {
								revolutions.Revolutions.MERCURY: astrology.SE_MERCURY,
								revolutions.Revolutions.VENUS:   astrology.SE_VENUS,
								revolutions.Revolutions.MARS:    astrology.SE_MARS,
								revolutions.Revolutions.JUPITER: astrology.SE_JUPITER,
								revolutions.Revolutions.SATURN:  astrology.SE_SATURN,
							}
							_planet_lookback_months = {
								revolutions.Revolutions.MERCURY: 4,
								revolutions.Revolutions.VENUS:   9,
								revolutions.Revolutions.MARS:    25,
								revolutions.Revolutions.JUPITER: 144,
								revolutions.Revolutions.SATURN:  355,
							}
							_planet_pid  = _planet_pid_map[_planet_sel]
							_lookback    = _planet_lookback_months[_planet_sel]
							self._planet_rev_seed = (int(t1), int(t2), int(t3))

							def _set_planet_rev_and_refresh(sy, sm, sd):
								revs2 = revolutions.Revolutions()
								ok2 = revs2.compute(_planet_sel, int(sy), int(sm), int(sd), radix)
								if not ok2:
									return
								ry = revs2.t[0]; rm = revs2.t[1]; rd = revs2.t[2]
								rhh = revs2.t[3]; rmi = revs2.t[4]; rss = revs2.t[5]
								try:
									if self.options.ayanamsha != 0:
										ry, rm, rd, rhh, rmi, rss = self.calcPrecNutCorrectedRevolution(
											revs2, _planet_pid, topo_place=self._rev_ctx['place'])
								except Exception:
									pass
								time2 = chart.Time(int(ry), int(rm), int(rd), int(rhh), int(rmi), int(rss),
											   False, radix.time.cal, chart.Time.GREENWICH,
											   self._rev_ctx['plus'], 0, 0, False, self._rev_ctx['place'], False)
								chart2 = chart.Chart(radix.name, radix.male, time2,
												 self._rev_ctx['place'], self._rev_ctx['revtype'], '', self.options, False)
								self._planet_rev_seed = (int(ry), int(rm), int(rd))
								active_cs2 = self._active_chart_session()
								if active_cs2 is not None:
									active_cs2.change_chart(
										chart2,
										display_datetime=(time2.year, time2.month, time2.day,
													  time2.hour, time2.minute, time2.second),
									)

							def _step_planet_forward():
								import datetime as _dt
								prev_seed = self._planet_rev_seed
								sy, sm, sd = prev_seed
								for attempt in range(10):
									try:
										nxt = _dt.date(int(sy), int(sm), int(sd)) + _dt.timedelta(days=1 + attempt)
										_set_planet_rev_and_refresh(nxt.year, nxt.month, nxt.day)
									except Exception:
										pass
									if self._planet_rev_seed != prev_seed:
										break

							def _step_planet_backward():
								prev_seed = self._planet_rev_seed
								sy, sm, sd = prev_seed
								for attempt in range(10):
									bm = sm - _lookback - attempt
									by = sy
									while bm < 1:
										bm += 12
										by -= 1
									_set_planet_rev_and_refresh(by, bm, 1)
									if self._planet_rev_seed != prev_seed:
										break

							from revolutionsdlg import RevolutionCallbackStepperController
							self._rev_stepper = RevolutionCallbackStepperController(
								step_backward_cb=_step_planet_backward,
								step_forward_cb=_step_planet_forward,
							)
							cs = self._active_chart_session()
							if cs is not None:
								cs._stepper = self._rev_stepper
							self.handleStatusBar(True)
							self.handleCaption(True)

					dlg.Destroy()
			else:
				dlgm = wx.MessageDialog(self, mtexts.txts['CouldnotComputeRevolution'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
				dlgm.ShowModal()
				dlgm.Destroy()
				pass
		finally:
			try:
				self.revdlg.Destroy()
			except Exception:
				pass
			self.revdlg = None

	def calcPrecNutCorrectedRevolution(self, revs, planet_id, topo_place=None, seed=None):
		"""
		Ayanamsha ON 리턴 정밀 보정(공통):
		- sid_lon = trop_lon - ayanamsha_ut(jd)
		- sid_speed = trop_speed - d(ayanamsha)/dt
		- (중요) topocentric일 때:
		  * 네이틀 목표각은 네이틀 place(출생지)로 계산
		  * 리턴(탐색) 쪽은 topo_place(리턴 다이얼로그에서 고른 place)로 계산
		- 마지막은 '정수 초'에서 |오차|가 최소가 되도록 스냅(달은 더 넓게)
		"""
		place_nat = self.horoscope.place
		place_trn = topo_place if topo_place is not None else place_nat

		# 1) 시작 JD(시드)
		if seed is not None:
			sy, sm, sd, sh, smin, ss = seed
		else:
			sy, sm, sd, sh, smin, ss = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]

		time0 = chart.Time(
			int(sy), int(sm), int(sd), int(sh), int(smin), int(ss),
			False, self.horoscope.time.cal, chart.Time.GREENWICH,
			False, 0, 0, False, place_trn, False
		)
		jd = time0.jd

		# 2) sid-mode는 ayanamsha_ut 계산을 위해서만 세팅(우린 lon 자체는 tropical로 계산)
		astrology.swe_set_sid_mode(self.options.ayanamsha-1, 0, 0)

		pflag = (astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED)
		if self.options.topocentric:
			pflag |= astrology.SEFLG_TOPOCTR

		def _wrap180(x):
			return (x + 180.0) % 360.0 - 180.0

		def _sid_lon_vel(jd_ut, pl):
			# topocentric은 호출 시점(place)에 맞춰 세팅
			if self.options.topocentric:
				astrology.swe_set_topo(pl.lon, pl.lat, pl.altitude)

			serr, dat = astrology.swe_calc_ut(jd_ut, planet_id, pflag)
			lon_trop = util.normalize(dat[0])
			vel_trop = dat[3]  # deg/day

			ay = astrology.swe_get_ayanamsa_ut(jd_ut)
			eps = 0.5  # days
			ay_p = astrology.swe_get_ayanamsa_ut(jd_ut + eps)
			ay_m = astrology.swe_get_ayanamsa_ut(jd_ut - eps)
			ay_rate = _wrap180(ay_p - ay_m) / (2.0 * eps)

			lon_sid = util.normalize(lon_trop - ay)
			vel_sid = vel_trop - ay_rate
			return lon_sid, vel_sid

		# 3) 네이틀 목표(네이틀 place 기준 고정)
		nat_lon_sid, _ = _sid_lon_vel(self.horoscope.time.jd, place_nat)

		def _f(jd_ut):
			# 탐색은 리턴 place 기준
			lon_sid, _ = _sid_lon_vel(jd_ut, place_trn)
			return _wrap180(nat_lon_sid - lon_sid)

		# 4) Newton (클램프 포함)
		diff = _f(jd)
		for _ in range(80):
			if abs(diff) <= 1e-10:
				break
			_, vel_sid = _sid_lon_vel(jd, place_trn)
			if abs(vel_sid) < 1e-7:
				break

			step = diff / vel_sid  # days
			if step > 30.0:
				step = 30.0
			elif step < -30.0:
				step = -30.0

			jd += step
			diff = _f(jd)

		# 5) 폴백: 브라켓+이분법
		if abs(diff) > 1e-8:
			_, vel_sid = _sid_lon_vel(jd, place_trn)
			span = 2.0 if abs(vel_sid) >= 0.3 else 40.0

			lo = jd - span
			hi = jd + span
			flo = _f(lo)
			fhi = _f(hi)

			for _ in range(12):
				if flo * fhi < 0.0:
					break
				span *= 2.0
				lo = jd - span
				hi = jd + span
				flo = _f(lo)
				fhi = _f(hi)

			if flo * fhi < 0.0:
				for _ in range(100):
					mid = (lo + hi) / 2.0
					fmid = _f(mid)
					if abs(fmid) <= 1e-10:
						jd = mid
						break
					if flo * fmid <= 0.0:
						hi = mid
						fhi = fmid
					else:
						lo = mid
						flo = fmid
					jd = (lo + hi) / 2.0

		# 6) 정수 초 스냅(달은 넓게)
		_, vel_sid = _sid_lon_vel(jd, place_trn)
		if planet_id == astrology.SE_MOON:
			W = 900   # 달은 topocentric/수치 잔차 대비(±15분)
		elif abs(vel_sid) < 0.05:
			W = 1200
		elif abs(vel_sid) < 0.3:
			W = 300
		else:
			W = 60

		jd0 = round(jd * 86400.0) / 86400.0
		best_jd = jd0
		best_abs = abs(_f(best_jd))
		for dt in range(-W, W + 1):
			jd_try = jd0 + (dt / 86400.0)
			v = abs(_f(jd_try))
			if v < best_abs:
				best_abs = v
				best_jd = jd_try
		jd = best_jd

		# 7) JD → YMDHMS
		y, m, d, hour = astrology.swe_revjul(jd, astrology.SE_GREG_CAL)
		total = int(round(hour * 3600.0))
		if total >= 24 * 3600:
			total -= 24 * 3600
			y, m, d = util.incrDay(int(y), int(m), int(d))
		elif total < 0:
			total += 24 * 3600
			y, m, d = util.decrDay(int(y), int(m), int(d))

		hh = total // 3600
		total %= 3600
		mi = total // 60
		ss = total % 60

		return int(y), int(m), int(d), int(hh), int(mi), int(ss)


	def calcPrecNutCorrectedSolar(self, revs):
		# 기존 호환: Solar는 generic을 호출
		return self.calcPrecNutCorrectedRevolution(revs, astrology.SE_SUN)

	def onSunTransits(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		if self.suntrdlg == None:
			self.suntrdlg = suntransitsdlg.SunTransitsDlg(None)
		self.suntrdlg.initialize(self.horoscope)

		self.suntrdlg.CenterOnParent()

		val = self.suntrdlg.ShowModal()
		if val == wx.ID_OK:	
			wx.BeginBusyCursor()

			lons = (self.horoscope.houses.ascmc[houses.Houses.ASC], self.horoscope.houses.ascmc[houses.Houses.MC], self.horoscope.planets.planets[astrology.SE_SUN].data[planets.Planet.LONG], self.horoscope.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG], self.horoscope.planets.planets[astrology.SE_MERCURY].data[planets.Planet.LONG], self.horoscope.planets.planets[astrology.SE_VENUS].data[planets.Planet.LONG], self.horoscope.planets.planets[astrology.SE_MARS].data[planets.Planet.LONG], self.horoscope.planets.planets[astrology.SE_JUPITER].data[planets.Planet.LONG], self.horoscope.planets.planets[astrology.SE_SATURN].data[planets.Planet.LONG], self.horoscope.planets.planets[astrology.SE_URANUS].data[planets.Planet.LONG], self.horoscope.planets.planets[astrology.SE_NEPTUNE].data[planets.Planet.LONG], self.horoscope.planets.planets[astrology.SE_PLUTO].data[planets.Planet.LONG])
			btns = (self.suntrdlg.ascrb.GetValue(), self.suntrdlg.mcrb.GetValue(), self.suntrdlg.sunrb.GetValue(), self.suntrdlg.moonrb.GetValue(), self.suntrdlg.mercuryrb.GetValue(), self.suntrdlg.venusrb.GetValue(), self.suntrdlg.marsrb.GetValue(), self.suntrdlg.jupiterrb.GetValue(), self.suntrdlg.saturnrb.GetValue(), self.suntrdlg.uranusrb.GetValue(), self.suntrdlg.neptunerb.GetValue(), self.suntrdlg.plutorb.GetValue())

			trlon = lons[0]
			for i in range(len(btns)):
				if btns[i]:
					trlon = lons[i]
			
			suntrs = suntransits.SunTransits()
			result = suntrs.compute(int(self.suntrdlg.year.GetValue()), int(self.suntrdlg.month.GetValue()), int(self.suntrdlg.day.GetValue()), self.horoscope, trlon)

			wx.EndBusyCursor()

			if result:
				dlg = timespacedlg.TimeSpaceDlg(self, mtexts.txts['SunTransits'], self.options.langid)
				ti = (suntrs.t[0], suntrs.t[1], suntrs.t[2], suntrs.t[3], suntrs.t[4], suntrs.t[5], chart.Time.GREGORIAN, chart.Time.GREENWICH, 0, 0)
				dlg.initialize(self.horoscope, ti)	
				dlg.CenterOnParent()

				val = dlg.ShowModal()

				if val == wx.ID_OK:
					wait = wx.BusyCursor()
					direc = dlg.placerbE.GetValue()
					hemis = dlg.placerbN.GetValue()
					place = chart.Place(dlg.birthplace.GetValue(), int(dlg.londeg.GetValue()), int(dlg.lonmin.GetValue()), 0, direc, int(dlg.latdeg.GetValue()), int(dlg.latmin.GetValue()), 0, hemis, 0)#Same as for the transits

					plus = True
					if dlg.pluscb.GetCurrentSelection() == 1:
						plus = False
					time = chart.Time(suntrs.t[0], suntrs.t[1], suntrs.t[2], suntrs.t[3], suntrs.t[4], suntrs.t[5], False, chart.Time.GREGORIAN, chart.Time.GREENWICH, plus, 0, 0, False, place, False)

					suntrschart = chart.Chart(self.horoscope.name, self.horoscope.male, time, place, chart.Chart.TRANSIT, '', self.options, False)

					label = mtexts.typeList[chart.Chart.TRANSIT]+' ('+str(time.year)+'.'+common.common.months[time.month-1]+'.'+str(time.day)+' '+str(time.hour)+':'+str(time.minute).zfill(2)+':'+str(time.second).zfill(2)+'('+mtexts.txts['GMT']+'))'
					self._open_workspace_session(
						suntrschart, session_label=label,
						radix=self.horoscope, view_mode=chart_session.ChartSession.COMPOUND,
						navigation_units=('day', 'hour', 'minute'),
						navigation_title_label=mtexts.typeList[chart.Chart.TRANSIT],
						display_datetime=(time.year, time.month, time.day, time.hour, time.minute, time.second),
					)

				dlg.Destroy()

			else:
				dlgm = wx.MessageDialog(self, mtexts.txts['CouldnotComputeTransit'], mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
				dlgm.ShowModal()
				dlgm.Destroy()#


	def onSecondaryDirs(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		if not self._should_prompt_quickcharts():
			self._open_current_secondary_dirs()
			return

		if self.secdirdlg == None:
			self.secdirdlg = secdirdlg.SecondaryDirsDlg(None)
		self.secdirdlg.initialize()
		radix = self._active_radix_chart()
		self.secdirdlg.age.SetValue(str(self._current_secondary_age(radix)))

		self.secdirdlg.CenterOnParent()

		val = self.secdirdlg.ShowModal()
		if val == wx.ID_OK:
			age = int(self.secdirdlg.age.GetValue())
			direct = self.secdirdlg.directrb.GetValue()
			soltime = self.secdirdlg.solartimerb.GetValue()

			zt = chart.Time.LOCALMEAN
			if soltime:
				zt = chart.Time.LOCALAPPARENT
			zh = 0
			zm = 0

			sdir = secdir.SecDir(radix, age, direct, soltime)
			y, m, d, hour, minute, second = sdir.compute()

			dlg = timespacedlg.TimeSpaceDlg(self, mtexts.txts['SecondaryDirs'], self.options.langid)
			ti = (y, m, d, hour, minute, second, self.horoscope.time.cal, zt, zh, zm)
			dlg.initialize(self.horoscope, ti)	
			dlg.CenterOnParent()

			val = dlg.ShowModal()

			if val == wx.ID_OK:
				wait = wx.BusyCursor()

				direc = dlg.placerbE.GetValue()
				hemis = dlg.placerbN.GetValue()
				place = chart.Place(dlg.birthplace.GetValue(), int(dlg.londeg.GetValue()), int(dlg.lonmin.GetValue()), 0, direc, int(dlg.latdeg.GetValue()), int(dlg.latmin.GetValue()), 0, hemis, 0)#Also, no altitude neccesary here

				plus = True
				if dlg.pluscb.GetCurrentSelection() == 1:
					plus = False
				time = chart.Time(y, m, d, hour, minute, second, False, radix.time.cal, zt, plus, zh, zm, False, place, False)

				secdirchart = chart.Chart(radix.name, radix.male, time, place, chart.Chart.TRANSIT, '', self.options, False)

				label = self._workspace_timed_label('Sec. Progression', time.year, time.month, time.day, time.hour, time.minute)
				doc = self._open_workspace_session(
					secdirchart, session_label=label,
					radix=radix, view_mode=chart_session.ChartSession.CHART,
					display_datetime=self._secondary_display_datetime_for_chart(secdirchart, radix),
				)
				if doc is not None:
					cs = self._active_chart_session()
					if cs is not None:
						# Keep stepper object alive for keyboard stepping; only popup visibility is gated.
						sd = stepperdlg.StepperDlg(self, radix, age, direct, soltime, self.options, self.title, on_step=self._make_stepper_callback(cs))
						cs._stepper = sd
						self.handleStatusBar(True)
						self.handleCaption(True)
						if ENABLE_SECONDARY_POPUP_STEPPER:
							sd.CenterOnParent()
							sd.Show(True)
						else:
							sd.Show(False)

			dlg.Destroy()

	def onSecProgPositionsByDate(self, event):
		#COLS = (mtexts.txts['Planets'], mtexts.txts['Longitude'], mtexts.txts['Latitude'], mtexts.txts['Dodecatemorion'], mtexts.txts['Declination'])
		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal(); dlgm.Destroy(); return
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)
		if self.splash:
			return

		import posfordate

		nt = self.horoscope.time

		def _caption_for(chrt):
			# 타이틀: "Positions for Date (진행날짜 ...)" 형태로
			t = chrt.time
			try:
				base = self.title.replace(mtexts.txts['Radix'], mtexts.txts['PositionForDate'])
			except Exception:
				base = self.title
			return base.replace(
				mtexts.txts['PositionForDate'],
				mtexts.txts['PositionForDate']+' ('+str(t.year)+'.'+common.common.months[t.month-1]+'.'+str(t.day)+' '+
				str(t.hour)+':'+str(t.minute).zfill(2)+':'+str(t.second).zfill(2)+')',
				1
			)
		def _on_posfordate_frame_close(evt):
			# 차트 창을 닫으면 secdirui도 같이 닫는다
			try:
				if hasattr(self, "_secui_dlg") and self._secui_dlg:
					try:
						self._secui_dlg.Destroy()
					except Exception:
						pass
					self._secui_dlg = None
			except Exception:
				pass

			# 프레임 레퍼런스도 정리 (죽은 핸들 방지)
			try:
				self._posfordate_fr = None
			except Exception:
				pass

			evt.Skip()

		def _bind_posfordate_frame_close(fr):
			# 중복 Bind 방지
			try:
				if fr and not getattr(fr, "_posfordate_closebound", False):
					fr.Bind(wx.EVT_CLOSE, _on_posfordate_frame_close)
					fr._posfordate_closebound = True
			except Exception:
				pass
		def _ensure_posfordate_stack():
			"""항상: 메인(라딕스) < Positions-for-Date 차트 < 팝업 다이얼로그"""
			# (재진입 방지) Raise가 다시 EVT_ACTIVATE를 유발할 수 있음
			if getattr(self, "_posfordate_stack_guard", False):
				return
			self._posfordate_stack_guard = True
			try:
				try:
					if hasattr(self, "_posfordate_fr") and self._posfordate_fr:
						self._posfordate_fr.Raise()
				except Exception:
					pass
				try:
					if hasattr(self, "_secui_dlg") and self._secui_dlg:
						self._secui_dlg.Raise()
				except Exception:
					pass
			finally:
				self._posfordate_stack_guard = False

		def _bind_secui_stack(dlg):
			try:
				if dlg and not getattr(dlg, "_posfordate_stackbound", False):
					try:
						dlg.SetWindowStyleFlag(dlg.GetWindowStyleFlag() | wx.FRAME_FLOAT_ON_PARENT)
					except Exception:
						pass
					dlg._posfordate_stackbound = True
			except Exception:
				pass
		def _apply(yy, mm_, dd_):
			# Calculate → 동일 프레임 갱신(차트로)
			try:
				age_int, age_years, (py, pm, pd), prg = posfordate.make_progressed_chart_by_real_date(
					self.horoscope, self.options, yy, mm_, dd_
				)

				# 라벨/입력 갱신: 정수 나이 = age_int (반올림 금지)
				try:
					self._secui_dlg.set_snapshot(int(age_int), (int(yy), int(mm_), int(dd_)), (int(py), int(pm), int(pd)))
				except Exception:
					pass

				# (선택) 예전 표 창이 열려있으면 닫아버림
				try:
					if hasattr(self, "_secprog_tbl") and self._secprog_tbl:
						self._secprog_tbl.Destroy()
						self._secprog_tbl = None
				except Exception:
					pass

				title = _caption_for(prg)

				if hasattr(self, "_posfordate_fr") and self._posfordate_fr:
					# 기존 프레임이 있으면 갱신
					self._posfordate_fr.change(prg, title)
					_bind_posfordate_frame_close(self._posfordate_fr)
					# change()가 타이틀을 건드릴 수 있어 확실히 덮어쓰기
					try:
						self._posfordate_fr.SetTitle(title)
						if hasattr(self._posfordate_fr, "_update_age_and_realdate"):
							self._posfordate_fr._update_age_and_realdate()
					except Exception:
						pass
					self._posfordate_fr.Raise()
				else:
					try:
						wx.CallAfter(_ensure_posfordate_stack)
					except Exception:
						pass
					# 없으면 새로 생성
					self._posfordate_fr = secdirframe.SecDirFrame(self, title, prg, self.horoscope, self.options)
					_bind_posfordate_frame_close(self._posfordate_fr)
					self._posfordate_fr.Show(True)
					self._posfordate_fr.Raise()
					try:
						wx.CallAfter(_ensure_posfordate_stack)
					except Exception:
						pass
			except Exception as e:
				try:
					wx.MessageBox(u"Positions for Date chart error (Calculate): %s" % e, mtexts.txts['PositionForDate'])
				except:
					pass
			# Calculate 후에도 스택 유지
			try:
				wx.CallAfter(_ensure_posfordate_stack)
			except Exception:
				pass
			return
		# 0세 차트 먼저 계산 (입력 기본값 = 네이탈 원래 날짜)
		try:
			by, bm, bd = nt.origyear, nt.origmonth, nt.origday
			age0i, age0, (ppy, ppm, ppd), prg0 = posfordate.make_progressed_chart_by_real_date(
				self.horoscope, self.options, by, bm, bd
			)
		except Exception:
			by, bm, bd = nt.origyear, nt.origmonth, nt.origday
			age0i, age0, (ppy, ppm, ppd), prg0 = 0, 0.0, (nt.origyear, nt.origmonth, nt.origday), self.horoscope

		# (선택) 예전 표 창이 열려있으면 닫기
		try:
			if hasattr(self, "_secprog_tbl") and self._secprog_tbl:
				self._secprog_tbl.Destroy()
				self._secprog_tbl = None
		except Exception:
			pass

		# 차트 프레임 생성/갱신 (먼저 차트를 띄우고)
		try:
			title0 = _caption_for(prg0)
			if not hasattr(self, "_posfordate_fr") or not self._posfordate_fr:
				self._posfordate_fr = secdirframe.SecDirFrame(self, title0, prg0, self.horoscope, self.options)
				_bind_posfordate_frame_close(self._posfordate_fr)
				self._posfordate_fr.Show(True)
				wx.CallAfter(self._posfordate_fr.Raise)
				wx.CallAfter(self._posfordate_fr.SetFocus)
			else:
				self._posfordate_fr.change(prg0, title0)
				_bind_posfordate_frame_close(self._posfordate_fr)
				try:
					self._posfordate_fr.SetTitle(title0)
					if hasattr(self._posfordate_fr, "_update_age_and_realdate"):
						self._posfordate_fr._update_age_and_realdate()
				except Exception:
					pass
				wx.CallAfter(self._posfordate_fr.Raise)
				wx.CallAfter(self._posfordate_fr.SetFocus)
		except Exception as e:
			try:
				wx.MessageBox(u"Positions for Date chart error (initial): %s" % e, mtexts.txts['PositionForDate'])
			except:
				pass

		# 다이얼로그 열기 (모델리스) — 부모를 '새 차트 프레임'으로 두고, 항상 차트 위로
		def _open_secui():
			parent_for_dlg = self._posfordate_fr if (hasattr(self, "_posfordate_fr") and self._posfordate_fr) else self
			self._secui_dlg = secdirui.SecDirDialog(parent_for_dlg, _apply, None)
			_bind_secui_stack(self._secui_dlg)
			try:
				self._secui_dlg.CenterOnParent()
			except Exception:
				pass
			self._secui_dlg.Show(True)

		try:
			need_new = (not hasattr(self, "_secui_dlg") or not self._secui_dlg)
			if not need_new:
				try:
					# 예전 패치로 '메인 프레임'을 부모로 잡아버린 경우 → 메인이 튀어올라 새 차트를 덮음
					if hasattr(self, "_posfordate_fr") and self._posfordate_fr:
						if self._secui_dlg.GetParent() != self._posfordate_fr:
							try:
								self._secui_dlg.Destroy()
							except Exception:
								pass
							self._secui_dlg = None
							need_new = True
				except Exception:
					need_new = True

			if need_new:
				_open_secui()
			else:
				_bind_secui_stack(self._secui_dlg)
				self._secui_dlg.Show(True)
		except Exception:
			try:
				if hasattr(self, "_secui_dlg") and self._secui_dlg:
					self._secui_dlg.Destroy()
			except Exception:
				pass
			self._secui_dlg = None
			_open_secui()

		# 라벨/입력 초기화(다이얼로그 생성 이후)
		try:
			self._secui_dlg.set_snapshot(int(age0i), (by, bm, bd), (ppy, ppm, ppd))
		except Exception:
			pass

		# 최종 스택: 메인 < 새 차트 < 팝업
		try:
			wx.CallAfter(_ensure_posfordate_stack)
		except Exception:
			pass
	def onElections(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.horoscope.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		time = chart.Time(self.horoscope.time.origyear, self.horoscope.time.origmonth, self.horoscope.time.origday, self.horoscope.time.hour, self.horoscope.time.minute, self.horoscope.time.second, self.horoscope.time.bc, self.horoscope.time.cal, self.horoscope.time.zt, self.horoscope.time.plus, self.horoscope.time.zh, self.horoscope.time.zm, self.horoscope.time.daylightsaving, self.horoscope.place, False, tzid=getattr(self.horoscope.time, 'tzid', ''), tzauto=getattr(self.horoscope.time, 'tzauto', False))

		electionchart = chart.Chart(self.horoscope.name, self.horoscope.male, time, self.horoscope.place, chart.Chart.TRANSIT, '', self.options, False)

		label = mtexts.txts['Elections']+' ('+str(time.origyear)+'.'+common.common.months[time.origmonth-1]+'.'+str(time.origday)+' '+str(time.hour)+':'+str(time.minute).zfill(2)+':'+str(time.second).zfill(2)+')'
		doc = self._open_workspace_session(
			electionchart, session_label=label,
			radix=self.horoscope, view_mode=chart_session.ChartSession.CHART,
			navigation_units=('day', 'hour', 'minute'),
			display_datetime=(time.origyear, time.origmonth, time.origday, time.hour, time.minute, time.second),
		)
		if doc is not None:
			cs = self._active_chart_session()
			if cs is not None:
				estepdlg = electionstepperdlg.ElectionStepperDlg(self, self.horoscope, self.options, self.title, on_step=self._make_stepper_callback(cs))
				cs._stepper = estepdlg
				estepdlg.CenterOnParent()
				estepdlg.Show(True)


	def onSquareChart(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		sc = squarechartframe.SquareChartFrame(self, self.title, self.horoscope, self.options)
		sc.Show(True)


	def onProfectionsChart(self, event):
		radix = self._active_radix_chart()
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if radix.time.bc:
			dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			return

		if not self._should_prompt_quickcharts():
			self._open_current_profections_chart()
			return

		pdlg = profdlg.ProfDlg(self, radix.time.jd, radix.place)
		now = datetime.datetime.now()
		pdlg.initialize(now.year, now.month, now.day, now.hour, now.minute, now.second)

		pdlg.CenterOnParent()

		val = pdlg.ShowModal()
		if val == wx.ID_OK:
			y = int(pdlg.year.GetValue())
			m = int(pdlg.month.GetValue())
			d = int(pdlg.day.GetValue())
			h = int(pdlg.hour.GetValue())
			mi = int(pdlg.minute.GetValue())
			s = int(pdlg.second.GetValue())
			proftype = chart.Chart.YEAR

			t = h+mi/60.0+s/3600.0

			if self.options.zodprof:
				prof = profections.Profections(radix, y, m, d, t)
				pchart = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PROFECTION, '', self.options, False, proftype)
				pchart.calcProfPos(prof)
			else:
				if not self.options.usezodprojsprof and (y == radix.time.year or (y-radix.time.year) % 12 == 0) and m == radix.time.month and d == radix.time.day:
					pchart = radix
				else:
					prof = munprofections.MunProfections(radix, y, m, d, t)
					proflondeg, proflonmin, proflonsec = util.decToDeg(prof.lonZ)
					profplace = chart.Place(mtexts.txts['Profections'], proflondeg, proflonmin, proflonsec, prof.east, radix.place.deglat, radix.place.minlat, radix.place.seclat, radix.place.north, radix.place.altitude)
					pchart = chart.Chart(radix.name, radix.male, radix.time, profplace, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
					pchartpls = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
					#modify planets ...
					pchart.planets.calcMundaneProfPos(pchart.houses.ascmc2, pchartpls.planets.planets, radix.place.lat, radix.obl[0])

					#modify lof
					pchart.fortune.calcMundaneProfPos(pchart.houses.ascmc2, pchartpls.fortune, radix.place.lat, radix.obl[0])
	
					#recalc AspMatrix
					pchart.calcAspMatrix()

			label = mtexts.txts['Profections']+' ('+str(y)+'.'+str(m)+'.'+str(d)+' '+str(h).zfill(2)+':'+str(mi).zfill(2)+':'+str(s).zfill(2)+')'
			doc = self._open_workspace_session(
				pchart, session_label=label,
				radix=radix, view_mode=chart_session.ChartSession.CHART,
				display_datetime=(y, m, d, h, mi, s),
			)
			if doc is not None:
				cs = self._active_chart_session()
				if cs is not None:
					pstepdlg = profectionstepperdlg.ProfectionStepperDlg(self, radix, y, m, d, t, self.options, self.title, on_step=self._make_stepper_callback(cs))
					cs._stepper = pstepdlg
					self.handleStatusBar(True)
					self.handleCaption(True)
					pstepdlg.CenterOnParent()
					pstepdlg.Show(True)

		pdlg.Destroy()


	def onMundaneChart(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

#		if self.horoscope.time.bc:
#	 		dlgm = wx.MessageDialog(self, mtexts.txts['NotAvailable'], '', wx.OK|wx.ICON_INFORMATION)
#			dlgm.ShowModal()
#			dlgm.Destroy()
#			return

		mf = mundaneframe.MundaneFrame(self, self.title, self.options, self.horoscope, None)
		mf.Show(True)


	#Options-menu
	def onAppearance1(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		wx.BeginBusyCursor()
		dlg = appearance1dlg.Appearance1Dlg(self)
		dlg.CenterOnParent()
		wx.EndBusyCursor()
		dlg.fill(self.options)

		topocentric = self.options.topocentric
#		traditionalaspects = self.options.traditionalaspects
		netb = self.options.netbook
		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if(dlg.check(self.options)):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveAppearance1():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if netb != self.options.netbook:
					if self.options.subprimarydir == primdirs.PrimDirs.BOTH:
						self.options.subprimarydir = primdirs.PrimDirs.MUNDANE

				if not self.splash:
					if topocentric != self.options.topocentric:
						self.horoscope.recalc()
#					elif traditionalaspects != self.options.traditionalaspects:
#						self.horoscope.recalcAlmutens()

					self.drawBkg()
					self.Refresh()
					self.refreshOpenWindows()

		dlg.Destroy()


	def onAppearance2(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		wx.BeginBusyCursor()
		dlg = appearance2dlg.Appearance2Dlg(self)
		dlg.CenterOnParent()
		wx.EndBusyCursor()
		dlg.fill(self.options)

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveAppearance2():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.drawBkg()
					self.Refresh()
					self.refreshOpenWindows()

		dlg.Destroy()


	def onSymbols(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = symbolsdlg.SymbolsDlg(self)
		dlg.CenterOnParent()
		dlg.fill(self.options)

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				common.common.update(self.options)

				if self.options.autosave:
					if self.options.saveSymbols():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.drawBkg()
					self.Refresh()
					self.refreshOpenWindows()

		dlg.Destroy()


	def onDignities(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = dignitiesdlg.DignitiesDlg(self, self.options)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveDignities():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onAyanamsha(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = ayanamshadlg.AyanamshaDlg(self)
		dlg.CenterOnParent()
		dlg.fill(self.options)

		ayan = self.options.ayanamsha
		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveAyanamsa():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()

					if ayan != self.options.ayanamsha:
						self.horoscope.recalc()

					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onColors(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = colorsdlg.ColorsDlg(self)
		dlg.CenterOnParent()
		dlg.fill(self.options)

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveColors():
						self.moptions.Enable(self.ID_SaveOpts, True)

				self._refresh_workspace_shell_theme()
				if not self.splash:
					self.drawBkg()
					self.Refresh()
					self.refreshOpenWindows()

		dlg.Destroy()


	def onHouseSystem(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		typ = event.GetId()-self.hsbase
		hs = houses.Houses.hsystems

		if typ < 0 or typ >= len(hs):
			return

		if self.options.hsys != hs[typ]:
			self.options.hsys = hs[typ]
			self.enableOptMenus(True)

			if self.options.autosave:
				if self.options.saveHouseSystem():
					self.moptions.Enable(self.ID_SaveOpts, True)

			if not self.splash:
				self.closeChildWnds()
				self.horoscope.setHouseSystem()
				self.horoscope.calcAspMatrix()
				self.horoscope.calcFixStarAspMatrix()
				self.horoscope.calcArabicParts()
				self.horoscope.recalcAlmutens()
				self.drawBkg()
				self.Refresh()


	def onNodes(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		typ = event.GetId()-self.nodebase
		nodes = (True, False)

		if self.options.meannode != nodes[typ]:
			self.options.meannode = nodes[typ]
			self.enableOptMenus(True)

			if self.options.autosave:
				if self.options.saveNodes():
					self.moptions.Enable(self.ID_SaveOpts, True)

			if not self.splash:
				self.closeChildWnds()
				self.horoscope.setNodes()
				self.horoscope.calcAspMatrix()
				self.horoscope.calcFixStarAspMatrix()
				self.drawBkg()
				self.Refresh()


	def onOrbs(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = orbisdlg.OrbisDlg(self, self.options)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			dlg.save(dlg.currid)

			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveOrbs():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.calcAspMatrix()
					self.horoscope.calcFixStarAspMatrix()
					self.horoscope.recalcAlmutens()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onFortune(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = fortunedlg.FortuneDlg(self)
		dlg.CenterOnParent()
		dlg.fill(self.options)

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveFortune():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.calcFortune()
					self.horoscope.calcArabicParts()
					self.horoscope.calcAntiscia()
					self.horoscope.recalcAlmutens()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onArabicParts(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		wx.BeginBusyCursor()
		dlg = arabicpartsdlg.ArabicPartsDlg(self, self.options)
		dlg.CenterOnParent()
		dlg.fill(self.options)
		wx.EndBusyCursor()

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			ch, rem = dlg.check(self.options)
			if ch:
				self.enableOptMenus(True)

				if rem:
					if self.options.topicals != None:
						del self.options.topicals	
						self.options.topicals = None

				if self.options.autosave:
					if self.options.saveTopicalandParts():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.calcFortune()
					self.horoscope.calcAntiscia()
					self.horoscope.calcArabicParts()
					self.horoscope.recalcAlmutens()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onSyzygy(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = syzygydlg.SyzygyDlg(self)
		dlg.CenterOnParent()
		dlg.fill(self.options)

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveSyzygy():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.calcSyzygy()
					self.horoscope.calcArabicParts()
					self.horoscope.recalcAlmutens()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onFixStarsOpt(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if not self.checkFixStars():
			return
# ###########################################
# Elias -  V 8.0.0
# ###########################################
		dlg = fixstarsdlg.FixStarsDlg(self, self.options, common.common.ephepath)
# ###########################################
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options.fixstars):
				self.enableOptMenus(True)

				self.options.clearPDFSSel()

				if self.options.autosave:
					if self.options.saveFixstars():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.rebuildFixStars()
					self.horoscope.calcFixStarAspMatrix()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onProfectionsOpt(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = profdlgopts.ProfDlgOpts(self)
		dlg.fill(self.options)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveProfections():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


# ###########################################
# Roberto change  V 7.2.0
	def onDefLocationOpt(self, event):
		dlg = defaultlocdlg.DefaultLocDlg(self, self.options.langid)
		dlg.fill(self.options)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveDefLocation():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()
# ###########################################		

	def onRevolutionsOpt(self, event):
		dlg = revolutionsoptdlg.RevolutionsOptDlg(self)
		dlg.fill(self.options)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveRevolutions():
						self.moptions.Enable(self.ID_SaveOpts, True)

		dlg.Destroy()

	def onQuickChartsOpt(self, event):
		dlg = quickchartsoptdlg.QuickChartsOptDlg(self)
		dlg.fill(self.options)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveQuickCharts():
						self.moptions.Enable(self.ID_SaveOpts, True)

		dlg.Destroy()

	def onStepAlertsOpt(self, event):
		dlg = stepalertsdlg.StepAlertsDlg(self, self.options)
		dlg.fill()
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:
			if dlg.check():
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveStepAlerts():
						self.moptions.Enable(self.ID_SaveOpts, True)

		dlg.Destroy()


	def onLanguages(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = langsdlg.LanguagesDlg(self, self.options.langid)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:
			if dlg.check(self.options):
				self.enableOptMenus(True)

				#if self.options.autosave:
				#	if self.options.saveLanguages():
				self.moptions.Enable(self.ID_SaveOpts, True)
				if not self.splash:
					self.closeChildWnds()
#-------------------------------------------------------------------------------
				self.enableOptMenus(True)

				hasChart = self.mtable.IsEnabled(self.ID_Aspects)

				#os.remove(os.path.join(common.common.ephepath, 'fixstars.cat'))
				if self.options.langid<6:
					common.common.abc = os.path.join('Res', 'FreeSans.ttf')
					#shutil.copyfile(os.path.join(common.common.ephepath, 'fixstarsE.cat'), os.path.join(common.common.ephepath, 'fixstars.cat'))
				else:
					if self.options.langid == 6:
						common.common.abc      = os.path.join('Res', 'NotoSansSC-Regular.ttf')
						common.common.abc_bold = os.path.join('Res', 'NotoSansSC-Bold.ttf')
					elif self.options.langid == 7:
						common.common.abc      = os.path.join('Res', 'NotoSansTC-Regular.ttf')
						common.common.abc_bold = os.path.join('Res', 'NotoSansTC-Bold.ttf')
					elif self.options.langid == 8:
						common.common.abc      = os.path.join('Res', 'NotoSansKR-Regular.ttf')
						common.common.abc_bold = os.path.join('Res', 'NotoSansKR-Bold.ttf')
					else:
						common.common.abc      = os.path.join('Res', 'FreeSans.ttf')
						common.common.abc_bold = os.path.join('Res', 'FreeSansBold.ttf')

					if not os.path.exists(common.common.abc_bold):
						common.common.abc_bold = common.common.abc

				mtexts.setLang(self.options.langid)

				try:
					# 프레임에서 메뉴바를 안전하게 떼고(분리) 새로 붙인다
					self.SetMenuBar(None)
				except Exception:
					pass
				# 새 메뉴바 생성

				self.menubar = wx.MenuBar()
				self.mhoros = wx.Menu()
				self.mtable = wx.Menu()
				self.moptions = wx.Menu()
				self.mcharts = wx.Menu()
				self.mhelp = wx.Menu()
				#self.mhoros.Destroy()

		#Horoscope-menu
# ###########################################
# Roberto change  V 7.2.0 # Elias v 8.0.0 add Dodecatemoria
				self.ID_New, self.ID_Data, self.ID_HereAndNow, self.ID_Load, self.ID_Save, self.ID_SaveAsBitmap, self.ID_Synastry, self.ID_FindTime, self.ID_Ephemeris, self.ID_Close, self.ID_Exit = range(100, 111)
# ###########################################

		#Table-menu
# ###########################################
# Roberto change  V 7.3.0 + V 8.0.1
				(self.ID_Positions, self.ID_TAlmutens, self.ID_AlmutenZodiacal, self.ID_AlmutenChart, self.ID_AlmutenTopical, self.ID_Misc, self.ID_MunPos,
				self.ID_Antiscia, self.ID_Aspects, self.ID_Midpoints, self.ID_RiseSet, self.ID_Speeds, self.ID_ZodPars, self.ID_FixStars, self.ID_FixStarsAsps,
				self.ID_Arabians, self.ID_Strip, self.ID_PlanetaryHours, self.ID_ExactTransits, self.ID_Profections, self.ID_CustomerSpeculum, self.ID_Firdaria, self.ID_PrimaryDirs,self.ID_Dodecatemoria ) = range(111,135)
				self.ID_ZodiacalReleasing = 136
				self.ID_Phasis = 137
				self.ID_Paranatellonta = 138
				self.ID_Circumambulation = 139
				self.ID_Eclipses = 186
				self.ID_FixStarAngleDirs = 185  # Angular directions of fixed stars
		#Charts-menu
				self.ID_Transits, self.ID_Revolutions, self.ID_SunTransits, self.ID_SecondaryDirs, self.ID_Elections, self.ID_SquareChart, self.ID_ProfectionsChart, self.ID_MundaneChart = range(140, 148)

				self.ID_SecProgMenu = 5000  # Secondary progressions (submenu header)
				# --- new submenu headers ---
				self.ID_PlanetsPointsMenu = 5001
				self.ID_FixedStarsMenu   = 5002
				self.ID_TimeLordsMenu    = 5003
				self.ID_PrimaryDirsMenu  = 5004
				self.ID_TransitsMenu     = 5005
				self.ID_ChartsMenu      = 5016
				# --- Options submenu headers ---
				# --- New submenu headers ---
				self.ID_SaveMenu            = 5006  # Horoscope > Save group
				self.ID_ArabicPartsOptMenu  = 5011  # Options > ArabicParts (Fortuna+Arabic Parts)
				self.ID_PrimaryDirsOptMenu  = 5012  # Options > PrimaryDirs (Dirs+Keys+PDs in Chart)
				self.ID_TimeLordsOptMenu    = 5013  # Options > TimeLords (Profections+Firdaria)
				self.ID_AppearanceOptMenu   = 5014  # Options > Appearance1 (Appearance1/2+Colors+Symbols)
				self.ID_DignitiesOptMenu    = 5015  # Options > Dignities (Dignities+Minor Dignities)
				self.ID_PlanetsPointsOptMenu    = 5017  # Options > Planets/Points
				# Secondary progressions (Charts submenu)
				self.ID_SecProgChart = 148
				self.ID_SecProgPositions = 149
		#Options-menu
# ###########################################
# Roberto change  V 7.2.0
				(self.ID_Appearance1, self.ID_Appearance2, self.ID_Symbols, self.ID_Dignities, self.ID_MinorDignities, self.ID_Triplicities, self.ID_Terms,
				self.ID_Decans, self.ID_Almutens, self.ID_ChartAlmuten, self.ID_Topical, self.ID_Colors, self.ID_Ayanamsha, self.ID_HouseSystem,
				self.ID_Nodes, self.ID_Orbs, self.ID_PrimaryDirsOpt, self.ID_PrimaryKeys, self.ID_PDsInChartOpt, self.ID_PDsInChartOptZod, self.ID_PDsInChartOptMun, self.ID_LotOfFortune, self.ID_ArabicParts, self.ID_Syzygy, self.ID_FixStarsOpt, self.ID_ProfectionsOpt, self.ID_FirdariaOpt, self.ID_DefLocationOpt, self.ID_Languages, self.ID_AutoSaveOpts, self.ID_SaveOpts, self.ID_Reload) = range(151, 183)
				self.ID_RevolutionsOpt = 1830
				self.ID_OtherRevolutions = 1831
				self.ID_Rev_Mercury = 1837
				self.ID_Rev_Venus   = 1838
				self.ID_Rev_Mars    = 1839
				self.ID_Rev_Jupiter = 1840
				self.ID_Rev_Saturn  = 1841
				self.ID_QuickChartsOpt = 1832
				self.ID_SetStartupChart = 1833
				self.ID_ClearStartupChart = 1834
				self.ID_StepAlertsOpt = 1835
# ###########################################

				self.ID_Housesystem1, self.ID_Housesystem2, self.ID_Housesystem3, self.ID_Housesystem4, self.ID_Housesystem5, self.ID_Housesystem6, self.ID_Housesystem7, self.ID_Housesystem8, self.ID_Housesystem9, self.ID_Housesystem10, self.ID_Housesystem11, self.ID_Housesystem12, self.ID_Housesystem13 = range(1050, 1063)

				self.ID_NodeMean = 1070
				self.ID_NodeTrue = 1071

				self.hsbase = 1050
				self.nodebase = 1070
# ###########################################
# Roberto change  V 7.2.0 /  V 7.3.0
		#Help-menu
				self.ID_Help = 183
				self.ID_About = 184
# ###########################################

		#Horoscope-menu
				self.mhoros.Append(self.ID_New, mtexts.menutxts['HMNew'], mtexts.menutxts['HMNewDoc'])
				self.mhoros.Append(self.ID_Data, mtexts.menutxts['HMData'], mtexts.menutxts['HMDataDoc'])
# ###########################################
# Roberto change  V 7.2.0
				self.mhoros.Append(self.ID_HereAndNow, mtexts.menutxts['HMHereAndNow'], mtexts.menutxts['HMHereAndNowDoc'])
# ###########################################
				self.mhoros.Append(self.ID_Load, mtexts.menutxts['HMLoad'], mtexts.menutxts['HMLoadDoc'])
				# Save group
				self.hsave = wx.Menu()
				self.hsave.Append(self.ID_Save,          mtexts.menutxts['HMSave'],       mtexts.menutxts['HMSaveDoc'])
				self.hsave.Append(self.ID_SaveAsBitmap,  mtexts.menutxts['HMSaveAsBmp'],  mtexts.menutxts['HMSaveAsBmpDoc'])
				self.mhoros.Append(self.ID_SaveMenu, mtexts.txts['Save'], self.hsave)
				self.mhoros.Append(self.ID_SetStartupChart, 'Use Current As Startup Chart', 'Load the current chart automatically at startup')
				self.mhoros.Append(self.ID_ClearStartupChart, 'Clear Startup Chart', 'Clear the automatic startup chart')

				self.mhoros.Append(self.ID_Synastry, mtexts.menutxts['HMSynastry'], mtexts.menutxts['HMSynastryDoc'])
				self.mhoros.Append(self.ID_FindTime, mtexts.menutxts['HMFindTime'], mtexts.menutxts['HMFindTimeDoc'])
				self.mhoros.Append(self.ID_Ephemeris, mtexts.menutxts['HMEphemeris'], mtexts.menutxts['HMEphemerisDoc'])
				self.mhoros.AppendSeparator()
				self.mhoros.Append(self.ID_Close, mtexts.menutxts['HMClose'], mtexts.menutxts['HMCloseDoc'])
				self.mhoros.AppendSeparator()
				self.mhoros.Append(self.ID_Exit, mtexts.menutxts['HMExit'], mtexts.menutxts['HMExitDoc'])

				self.filehistory = wx.FileHistory()
				self.filehistory.UseMenu(self.mhoros)
				self.Bind(wx.EVT_MENU_RANGE, self.OnFileHistory, id=wx.ID_FILE1, id2=wx.ID_FILE9)

		#Table-menu
				# ---------------- Tables (grouped) ----------------

				# Planets/Points
				self.tplanets = wx.Menu()
				self.tplanets.Append(self.ID_Positions,        mtexts.menutxts['TMPositions'],        mtexts.menutxts['TMPositionsDoc'])    
				self.tplanets.Append(self.ID_Antiscia,         mtexts.menutxts['TMAntiscia'],         mtexts.menutxts['TMAntisciaDoc'])          
				self.tplanets.Append(self.ID_Dodecatemoria,    mtexts.menutxts['TMDodecatemoria'],    mtexts.menutxts['TMDodecatemoriaDoc'])
				self.tplanets.Append(self.ID_Strip,            mtexts.menutxts['TMStrip'],            mtexts.menutxts['TMStripDoc']) 
				self.tplanets.Append(self.ID_Aspects,          mtexts.menutxts['TMAspects'],          mtexts.menutxts['TMAspectsDoc']) 
				self.tplanets.Append(self.ID_ZodPars,          mtexts.menutxts['TMZodPars'],          mtexts.menutxts['TMZodParsDoc'])
				self.tplanets.Append(self.ID_Speeds,           mtexts.menutxts['TMSpeeds'],           mtexts.menutxts['TMSpeedsDoc'])
				self.tplanets.Append(self.ID_RiseSet,          mtexts.menutxts['TMRiseSet'],          mtexts.menutxts['TMRiseSetDoc'])     
				self.tplanets.Append(self.ID_PlanetaryHours,   mtexts.menutxts['TMPlanetaryHours'],   mtexts.menutxts['TMPlanetaryHoursDoc'])
				self.tplanets.Append(self.ID_Phasis,           mtexts.menutxts['TMPhasis'],           mtexts.menutxts['TMPhasisDoc'])     
				self.tplanets.Append(self.ID_Midpoints,        mtexts.menutxts['TMMidpoints'],        mtexts.menutxts['TMMidpointsDoc'])
				self.tplanets.Append(self.ID_Arabians,         mtexts.menutxts['TMArabianParts'],     mtexts.menutxts['TMArabianPartsDoc'])
				self.tplanets.Append(self.ID_Eclipses,         mtexts.menutxts['TMEclipses'],         mtexts.menutxts['TMEclipsesDoc'])
				self.tplanets.Append(self.ID_Misc,             mtexts.menutxts['TMMisc'],             mtexts.menutxts['TMMiscDoc'])
				self.mtable.Append(self.ID_PlanetsPointsMenu, mtexts.txts['PlanetsPoints'], self.tplanets)

				# Almutens (existing submenu)
				self.talmutens = wx.Menu()
				self.talmutens.Append(self.ID_AlmutenChart,    mtexts.menutxts['TMAlmutenChart'],    mtexts.menutxts['TMAlmutenChartDoc'])
				self.talmutens.Append(self.ID_AlmutenZodiacal, mtexts.menutxts['TMAlmutenZodiacal'], mtexts.menutxts['TMAlmutenZodiacalDoc'])
				
				self.talmutens.Append(self.ID_AlmutenTopical,  mtexts.menutxts['TMAlmutenTopical'],  mtexts.menutxts['TMAlmutenTopicalDoc'])
				self.mtable.Append(self.ID_TAlmutens, mtexts.menutxts['TMAlmutens'], self.talmutens)
				# (Almutens 서브메뉴가 이미 존재하는 형태는 파일에 보임) :contentReference[oaicite:4]{index=4}

				# Fixed Stars
				self.tfixed = wx.Menu()
				self.tfixed.Append(self.ID_FixStars,        mtexts.menutxts['TMFixStars'],        mtexts.menutxts['TMFixStarsDoc'])
				self.tfixed.Append(self.ID_FixStarsAsps,    mtexts.menutxts['TMFixStarsAsps'],    mtexts.menutxts['TMFixStarsAspsDoc'])
				self.tfixed.Append(self.ID_FixStarsParallels, mtexts.menutxts['TMFixStarsParallels'], mtexts.menutxts['TMFixStarsParallelsDoc'])
				self.tfixed.Append(self.ID_Paranatellonta,  mtexts.menutxts['TMParanatellonta'],  mtexts.menutxts['TMParanatellontaDoc'])
				self.tfixed.Append(self.ID_AngleAtBirth,    mtexts.menutxts['TMAngleAtBirth'],    mtexts.menutxts['TMAngleAtBirthDoc'])
				self.mtable.Append(self.ID_FixedStarsMenu, mtexts.txts['FixStars'], self.tfixed)

				# Time Lords
				self.ttimelords = wx.Menu()
				self.ttimelords.Append(self.ID_Profections,        mtexts.menutxts['TMProfections'],        mtexts.menutxts['TMProfectionsDoc'])
				self.ttimelords.Append(self.ID_Firdaria,           mtexts.menutxts['TMFirdaria'],           mtexts.menutxts['TMFirdariaDoc'])
				self.ttimelords.Append(self.ID_Decennials,        mtexts.menutxts['TMDecennials'],        mtexts.menutxts['TMDecennialsDoc'])
				self.ttimelords.Append(self.ID_ZodiacalReleasing,  mtexts.menutxts['TMZodiacalReleasing'],  mtexts.menutxts['TMZodiacalReleasingDoc'])
				self.ttimelords.Append(self.ID_Circumambulation,   mtexts.menutxts['TMCircumambulation'],   mtexts.menutxts['TMCircumambulationDoc'])
				
				self.mtable.Append(self.ID_TimeLordsMenu, mtexts.txts['TimeLords'], self.ttimelords)

				# Primary Directions
				self.tpd = wx.Menu()
				self.tpd.Append(self.ID_PrimaryDirs,        mtexts.menutxts['TMPrimaryDirs'],        mtexts.menutxts['TMPrimaryDirsDoc'])
				self.tpd.Append(self.ID_FixStarAngleDirs,   mtexts.menutxts['TMFixStarAngleDirs'],   mtexts.menutxts['TMFixStarAngleDirsDoc'])
				self.tpd.Append(self.ID_MunPos,           mtexts.menutxts['TMMunPos'],           mtexts.menutxts['TMMunPosDoc'])
				self.tpd.Append(self.ID_CustomerSpeculum,   mtexts.menutxts['TMCustomerSpeculum'],   mtexts.menutxts['TMCustomerSpeculumDoc'])
				self.mtable.Append(self.ID_PrimaryDirsMenu, mtexts.txts['PrimaryDirs'], self.tpd)

				# Un-grouped (요청대로 단독 유지)
				self.mtable.Append(self.ID_ExactTransits, mtexts.menutxts['TMExactTransits'], mtexts.menutxts['TMExactTransitsDoc'])
				self.mtable.Append(self.ID_SearchModule, mtexts.txts.get('Search', 'Search')+'...\tS', 'Open the multi-technique search pane')

		#Charts-menu
				# 앞부분: 기본 항목 먼저
				self.chartsmenu2 = wx.Menu()
				self.chartsmenu2.Append(self.ID_SquareChart,     mtexts.menutxts['PMSquareChart'],     mtexts.menutxts['PMSquareChartDoc'])
				self.chartsmenu2.Append(self.ID_MundaneChart,    mtexts.menutxts['PMMundane'],         mtexts.menutxts['PMMundaneDoc'])
				self.chartsmenu2.Append(self.ID_Elections,       mtexts.menutxts['PMElections'],       mtexts.menutxts['PMElectionsDoc'])
				self.mcharts.Append(self.ID_ChartsMenu, mtexts.txts['DCharts'], self.chartsmenu2)

				self.mcharts.Append(self.ID_ProfectionsChart,mtexts.menutxts['PMProfections'],     mtexts.menutxts['PMProfectionsDoc'])

				# Secondary Progressions 서브메뉴(기존 그대로)
				self.csecprog = wx.Menu()
				self.csecprog.Append(self.ID_SecProgChart,     mtexts.menutxts['PMSecondaryDirs'],    mtexts.menutxts['PMSecondaryDirsDoc'])
				self.csecprog.Append(self.ID_SecProgPositions, mtexts.menutxts['PMPositionForDate'],  mtexts.menutxts['PMPositionForDateDoc'])
				self.mcharts.Append(self.ID_SecProgMenu, mtexts.txts['SecondaryDirs'], self.csecprog)
				
				self.mcharts.Append(self.ID_Revolutions,     'Solar Revolution\tR',     'Open solar revolution with saved settings')
				self.crevolutions = wx.Menu()
				self.crevolutions.Append(self.ID_Rev_Mercury, 'Mercury Return', '')
				self.crevolutions.Append(self.ID_Rev_Venus,   'Venus Return',   '')
				self.crevolutions.Append(self.ID_Rev_Mars,    'Mars Return',    '')
				self.crevolutions.Append(self.ID_Rev_Jupiter, 'Jupiter Return', '')
				self.crevolutions.Append(self.ID_Rev_Saturn,  'Saturn Return',  '')
				self.mcharts.Append(self.ID_OtherRevolutions, 'Other Revolutions', self.crevolutions)

				# Transits 서브메뉴 신설
				self.ctransits = wx.Menu()
				self.ctransits.Append(self.ID_Transits,    mtexts.menutxts['PMTransits'],    mtexts.menutxts['PMTransitsDoc'])
				self.ctransits.Append(self.ID_SunTransits, mtexts.menutxts['PMSunTransits'], mtexts.menutxts['PMSunTransitsDoc'])
				self.mcharts.Append(self.ID_TransitsMenu, mtexts.txts['Transits'], self.ctransits)

		#Options-menu
				self.mhousesystem = wx.Menu()
				self.itplac = self.mhousesystem.Append(self.ID_Housesystem1, mtexts.menutxts['OMHSPlacidus'], '', wx.ITEM_RADIO)
				self.itkoch = self.mhousesystem.Append(self.ID_Housesystem2, mtexts.menutxts['OMHSKoch'], '', wx.ITEM_RADIO)
				self.itregio = self.mhousesystem.Append(self.ID_Housesystem3, mtexts.menutxts['OMHSRegiomontanus'], '', wx.ITEM_RADIO)
				self.itcampa = self.mhousesystem.Append(self.ID_Housesystem4, mtexts.menutxts['OMHSCampanus'], '', wx.ITEM_RADIO)
				self.itequal = self.mhousesystem.Append(self.ID_Housesystem5, mtexts.menutxts['OMHSEqual'], '', wx.ITEM_RADIO)
				self.itwholesign = self.mhousesystem.Append(self.ID_Housesystem6, mtexts.menutxts['OMHSWholeSign'], '', wx.ITEM_RADIO)
				self.itaxial = self.mhousesystem.Append(self.ID_Housesystem7, mtexts.menutxts['OMHSAxial'], '', wx.ITEM_RADIO)
				self.itmorin = self.mhousesystem.Append(self.ID_Housesystem8, mtexts.menutxts['OMHSMorinus'], '', wx.ITEM_RADIO)
				self.ithoriz = self.mhousesystem.Append(self.ID_Housesystem9, mtexts.menutxts['OMHSHorizontal'], '', wx.ITEM_RADIO)
				self.itpage = self.mhousesystem.Append(self.ID_Housesystem10, mtexts.menutxts['OMHSPagePolich'], '', wx.ITEM_RADIO)
				self.italcab = self.mhousesystem.Append(self.ID_Housesystem11, mtexts.menutxts['OMHSAlcabitus'], '', wx.ITEM_RADIO)
				self.itporph = self.mhousesystem.Append(self.ID_Housesystem12, mtexts.menutxts['OMHSPorphyrius'], '', wx.ITEM_RADIO)
				self.itnohouses = self.mhousesystem.Append(self.ID_Housesystem13, mtexts.menutxts.get('OMHSNoHouses', 'Angles only (no house lines)'), '', wx.ITEM_RADIO)

				# [Appearance1] submenu: Appearance1/Speculum(=Appearance2)/Colors/Symbols
				self.o_appearance = wx.Menu()
				self.o_appearance.Append(self.ID_Appearance1, mtexts.menutxts['OMAppearance1'], mtexts.menutxts['OMAppearance1Doc'])
				self.o_appearance.Append(self.ID_NatalSecondaryCycle, 'Cycle secondary view\tCtrl+G', 'Cycles the radix secondary view')

				self.o_appearance.Append(self.ID_Colors,      mtexts.menutxts['OMColors'],      mtexts.menutxts['OMColorsDoc'])
				self.o_appearance.Append(self.ID_Symbols,     mtexts.menutxts['OMSymbols'],     mtexts.menutxts['OMSymbolsDoc'])
				self.moptions.Append(self.ID_AppearanceOptMenu, mtexts.txts['DDCharts'], self.o_appearance)

				self.o_appearance.Append(self.ID_Ayanamsha, mtexts.menutxts['OMAyanamsha'], mtexts.menutxts['OMAyanamshaDoc'])
				self.o_appearance.Append(self.ID_HouseSystem, mtexts.menutxts['OMHouseSystem'], self.mhousesystem)
				self.setHouse()

				self.o_planetsopt = wx.Menu()
				self.o_planetsopt.Append(self.ID_Appearance2, mtexts.menutxts['OMAppearance2'], mtexts.menutxts['OMAppearance2Doc'])
				self.o_planetsopt.Append(self.ID_Orbs, mtexts.menutxts['OMOrbs'], mtexts.menutxts['OMOrbsDoc'])
				# [Dignities] submenu: Dignities + Minor Dignities(submenu)
				self.o_digs = wx.Menu()
				self.o_digs.Append(self.ID_Dignities, mtexts.menutxts['OMDignities'], mtexts.menutxts['OMDignitiesDoc'])
				self.mdignities = wx.Menu()
				self.mdignities.Append(self.ID_Triplicities, mtexts.menutxts['OMTriplicities'], mtexts.menutxts['OMTriplicitiesDoc'])
				self.mdignities.Append(self.ID_Terms,        mtexts.menutxts['OMTerms'],        mtexts.menutxts['OMTermsDoc'])
				self.mdignities.Append(self.ID_Decans,       mtexts.menutxts['OMDecans'],       mtexts.menutxts['OMDecansDoc'])
				self.o_digs.Append(self.ID_MinorDignities, mtexts.menutxts['OMMinorDignities'], self.mdignities)
				self.o_planetsopt.Append(self.ID_DignitiesOptMenu, mtexts.txts['Dignities'], self.o_digs)
				self.mnodes = wx.Menu()
				self.meanitem = self.mnodes.Append(self.ID_NodeMean, mtexts.menutxts['OMNMean'], '', wx.ITEM_RADIO)
				self.trueitem = self.mnodes.Append(self.ID_NodeTrue, mtexts.menutxts['OMNTrue'], '', wx.ITEM_RADIO)
				self.o_planetsopt.Append(self.ID_Nodes, mtexts.menutxts['OMNodes'], self.mnodes)
				self.setNode()
				# [ArabicParts] submenu: Arabic Parts(first) + Fortuna(second)
				self.o_arabic = wx.Menu()
				self.o_arabic.Append(self.ID_ArabicParts,  mtexts.menutxts['OMArabicParts'],  mtexts.menutxts['OMArabicPartsDoc'])
				self.o_arabic.Append(self.ID_LotOfFortune, mtexts.menutxts['OMLotFortune'],   mtexts.menutxts['OMLotFortuneDoc'])
				self.o_planetsopt.Append(self.ID_ArabicPartsOptMenu, mtexts.txts['ArabicParts'], self.o_arabic)

				self.o_planetsopt.Append(self.ID_Syzygy,      mtexts.menutxts['OMSyzygy'],      mtexts.menutxts['OMSyzygyDoc'])
				self.moptions.Append(self.ID_PlanetsPointsOptMenu, mtexts.txts['PlanetsPoints'], self.o_planetsopt)

				self.malmutens = wx.Menu()
				self.malmutens.Append(self.ID_ChartAlmuten, mtexts.menutxts['OMChartAlmuten'], mtexts.menutxts['OMChartAlmutenDoc'])
				self.malmutens.Append(self.ID_Topical, mtexts.menutxts['OMTopical'], mtexts.menutxts['OMTopicalDoc'])
				self.moptions.Append(self.ID_Almutens, mtexts.menutxts['OMAlmutens'], self.malmutens)

				self.moptions.Append(self.ID_FixStarsOpt, mtexts.menutxts['OMFixStarsOpt'], mtexts.menutxts['OMFixStarsOptDoc'])
				
				# [TimeLords] submenu: Profections + Firdaria
				self.o_tl = wx.Menu()
				self.o_tl.Append(self.ID_ProfectionsOpt, mtexts.menutxts['OMProfectionsOpt'], mtexts.menutxts['OMProfectionsOptDoc'])
				self.o_tl.Append(self.ID_FirdariaOpt,    mtexts.menutxts['OMFirdariaOpt'],    mtexts.menutxts['OMFirdariaOptDoc'])
				self.moptions.Append(self.ID_TimeLordsOptMenu, mtexts.txts['TimeLords'], self.o_tl)

				# [PrimaryDirs] submenu: Primary Dirs + Primary Keys + PDs in Chart(submenu)
				self.o_pd = wx.Menu()
				self.o_pd.Append(self.ID_PrimaryDirsOpt, mtexts.menutxts['OMPrimaryDirs'], mtexts.menutxts['OMPrimaryDirsDoc'])
				self.o_pd.Append(self.ID_PrimaryKeys,    mtexts.menutxts['OMPrimaryKeys'], mtexts.menutxts['OMPrimaryKeysDoc'])
				self.mpdsinchartopts = wx.Menu()
				self.mpdsinchartopts.Append(self.ID_PDsInChartOptZod, mtexts.menutxts['OMPDsInChartOptZod'], mtexts.menutxts['OMPDsInChartOptZodDoc'])
				self.mpdsinchartopts.Append(self.ID_PDsInChartOptMun, mtexts.menutxts['OMPDsInChartOptMun'], mtexts.menutxts['OMPDsInChartOptMunDoc'])
				self.o_pd.Append(self.ID_PDsInChartOpt, mtexts.menutxts['OMPDsInChartOpt'], self.mpdsinchartopts)
				self.moptions.Append(self.ID_PrimaryDirsOptMenu, mtexts.txts['PrimaryDirs'], self.o_pd)

				# ###########################################
				# Roberto change V 7.2.0
				self.moptions.Append(self.ID_DefLocationOpt, mtexts.menutxts['OMDefLocationOpt'], mtexts.menutxts['OMDefLocationOptDoc'])
				# ###########################################
				self.moptions.Append(self.ID_RevolutionsOpt, 'Revolutions', 'Shows revolution settings')
				self.moptions.Append(self.ID_QuickChartsOpt, 'Supplementary Charts', 'Shows quick supplemental chart settings')
				self.moptions.Append(self.ID_StepAlertsOpt, 'Stepping Alerts', 'Shows exact stepping alert settings')
				self.moptions.Append(self.ID_Languages, mtexts.menutxts['OMLanguages'], mtexts.menutxts['OMLanguagesDoc'])
				self.moptions.AppendSeparator()
				self.autosave = self.moptions.Append(self.ID_AutoSaveOpts, mtexts.menutxts['OMAutoSave'], mtexts.menutxts['OMAutoSaveDoc'], wx.ITEM_CHECK)
				self.moptions.Append(self.ID_SaveOpts, mtexts.menutxts['OMSave'], mtexts.menutxts['OMSaveDoc'])
				self.moptions.Append(self.ID_Reload, mtexts.menutxts['OMReload'], mtexts.menutxts['OMReloadDoc'])

				self.setAutoSave()

		#Help-menu
				self.mhelp.Append(self.ID_Help, mtexts.menutxts['HEMHelp'], mtexts.menutxts['HEMHelpDoc'])
				self.mhelp.Append(self.ID_About, mtexts.menutxts['HEMAbout'], mtexts.menutxts['HEMAboutDoc'])


				self.menubar.Append(self.mhoros, mtexts.menutxts['MHoroscope'])
				self.menubar.Append(self.mtable, mtexts.menutxts['MTable'])
				self.menubar.Append(self.mcharts, mtexts.menutxts['MCharts'])
				self.menubar.Append(self.moptions, mtexts.menutxts['MOptions'])
				self.menubar.Append(self.mhelp, mtexts.menutxts['MHelp'])
				self.SetMenuBar(self.menubar)
				self._apply_custom_shortcut_labels()

				self.handleStatusBar(False)

				self.Bind(wx.EVT_MENU, self.onNew, id=self.ID_New)
				self.Bind(wx.EVT_MENU, self.onData, id=self.ID_Data)
				self.Bind(wx.EVT_MENU, self.onLoad, id=self.ID_Load)
# ###########################################
# Roberto change  V 7.2.0
				self.Bind(wx.EVT_MENU, self.onHereAndNow, id=self.ID_HereAndNow)
# ###########################################
				self.Bind(wx.EVT_MENU, self.onSave, id=self.ID_Save)
				self.Bind(wx.EVT_MENU, self.onSaveAsBitmap, id=self.ID_SaveAsBitmap)
				self.Bind(wx.EVT_MENU, self.onSynastry, id=self.ID_Synastry)
				self.Bind(wx.EVT_MENU, self.onFindTime, id=self.ID_FindTime)
				self.Bind(wx.EVT_MENU, self.onEphemeris, id=self.ID_Ephemeris)
				self.Bind(wx.EVT_MENU, self.onClose, id=self.ID_Close)
				self.Bind(wx.EVT_MENU, self.onExit, id=self.ID_Exit)

				if os.name == 'mac' or os.name == 'posix':
					self.Bind(wx.EVT_PAINT, self.onPaint)
				else:
					self.Bind(wx.EVT_ERASE_BACKGROUND, self.onEraseBackground)

				self.Bind(wx.EVT_SIZE, self.onSize)
				self.Bind(wx.EVT_MENU_OPEN, self.onMenuOpen)
		#The events EVT_MENU_OPEN and CLOSE are not called on windows in case of accelarator-keys
				self.Bind(wx.EVT_MENU_CLOSE, self.onMenuClose)

				self.Bind(wx.EVT_MENU, self.onPositions, id=self.ID_Positions)
				self.Bind(wx.EVT_MENU, self.onAlmutenZodiacal, id=self.ID_AlmutenZodiacal)
				self.Bind(wx.EVT_MENU, self.onAlmutenChart, id=self.ID_AlmutenChart)
				self.Bind(wx.EVT_MENU, self.onAlmutenTopical, id=self.ID_AlmutenTopical)
				self.Bind(wx.EVT_MENU, self.onMisc, id=self.ID_Misc)
				self.Bind(wx.EVT_MENU, self.onMunPos, id=self.ID_MunPos)
				self.Bind(wx.EVT_MENU, self.onAntiscia, id=self.ID_Antiscia)
# ###################################
# Elias change v 8.0.0
#		self.Bind(wx.EVT_MENU, self.onDodecatemoria, id=self.ID_Dodecatemoria)
# ###################################
				self.Bind(wx.EVT_MENU, self.onAspects, id=self.ID_Aspects)
				self.Bind(wx.EVT_MENU, self.onFixStars, id=self.ID_FixStars)
				self.Bind(wx.EVT_MENU, self.onFixStarsAsps, id=self.ID_FixStarsAsps)
				self.Bind(wx.EVT_MENU, self.onFixStarsParallels, id=self.ID_FixStarsParallels)
				self.Bind(wx.EVT_MENU, self.onMidpoints, id=self.ID_Midpoints)
				self.Bind(wx.EVT_MENU, self.onRiseSet, id=self.ID_RiseSet)
				self.Bind(wx.EVT_MENU, self.onSpeeds, id=self.ID_Speeds)
				self.Bind(wx.EVT_MENU, self.onZodPars, id=self.ID_ZodPars)
				self.Bind(wx.EVT_MENU, self.onArabians, id=self.ID_Arabians)
				self.Bind(wx.EVT_MENU, self.onStrip, id=self.ID_Strip)
				self.Bind(wx.EVT_MENU, self.onPlanetaryHours, id=self.ID_PlanetaryHours)
				self.Bind(wx.EVT_MENU, self.onExactTransits, id=self.ID_ExactTransits)
				self.Bind(wx.EVT_MENU, self.onSearchModule, id=self.ID_SearchModule)
				self.Bind(wx.EVT_MENU, self.onProfections, id=self.ID_Profections)
# ###########################################
# Roberto change V 7.3.0
				self.Bind(wx.EVT_MENU, self.onFirdaria, id=self.ID_Firdaria)
# ###########################################
# ###################################
# Roberto change v 8.0.1
				self.Bind(wx.EVT_MENU, self.onDodecatemoria, id=self.ID_Dodecatemoria)
# ###################################
				self.Bind(wx.EVT_MENU, self.onCustomerSpeculum, id=self.ID_CustomerSpeculum)
				self.Bind(wx.EVT_MENU, self.onPrimaryDirs, id=self.ID_PrimaryDirs)

				self.Bind(wx.EVT_MENU, self.onTransits, id=self.ID_Transits)
				self.Bind(wx.EVT_MENU, self.onQuickSolarRevolution, id=self.ID_Revolutions)
				self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.MERCURY), id=self.ID_Rev_Mercury)
				self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.VENUS),   id=self.ID_Rev_Venus)
				self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.MARS),    id=self.ID_Rev_Mars)
				self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.JUPITER), id=self.ID_Rev_Jupiter)
				self.Bind(wx.EVT_MENU, lambda e: self._open_quick_planet_revolution(revolutions.Revolutions.SATURN),  id=self.ID_Rev_Saturn)
				self.Bind(wx.EVT_MENU, self.onSunTransits, id=self.ID_SunTransits)
				self.Bind(wx.EVT_MENU, self.onSecondaryDirs, id=self.ID_SecondaryDirs)
				self.Bind(wx.EVT_MENU, self.onElections, id=self.ID_Elections)
				self.Bind(wx.EVT_MENU, self.onSquareChart, id=self.ID_SquareChart)
				self.Bind(wx.EVT_MENU, self.onProfectionsChart, id=self.ID_ProfectionsChart)
				self.Bind(wx.EVT_MENU, self.onMundaneChart, id=self.ID_MundaneChart)

				self.Bind(wx.EVT_MENU, self.onAppearance1, id=self.ID_Appearance1)
				self.Bind(wx.EVT_MENU, self.onAppearance2, id=self.ID_Appearance2)
				self.Bind(wx.EVT_MENU, self.onSymbols, id=self.ID_Symbols)
				self.Bind(wx.EVT_MENU, self.onDignities, id=self.ID_Dignities)
				self.Bind(wx.EVT_MENU, self.onAyanamsha, id=self.ID_Ayanamsha)
				self.Bind(wx.EVT_MENU, self.onColors, id=self.ID_Colors)
				self.Bind(wx.EVT_MENU_RANGE, self.onHouseSystem, id=self.ID_Housesystem1, id2=self.ID_Housesystem13)
				self.Bind(wx.EVT_MENU_RANGE, self.onNodes, id=self.ID_NodeMean, id2=self.ID_NodeTrue)
				self.Bind(wx.EVT_MENU, self.onOrbs, id=self.ID_Orbs)
				self.Bind(wx.EVT_MENU, self.onPrimaryDirsOpt, id=self.ID_PrimaryDirsOpt)
				self.Bind(wx.EVT_MENU, self.onPrimaryKeys, id=self.ID_PrimaryKeys)
				self.Bind(wx.EVT_MENU, self.onPDsInChartOptZod, id=self.ID_PDsInChartOptZod)
				self.Bind(wx.EVT_MENU, self.onPDsInChartOptMun, id=self.ID_PDsInChartOptMun)
				self.Bind(wx.EVT_MENU, self.onFortune, id=self.ID_LotOfFortune)
				self.Bind(wx.EVT_MENU, self.onArabicParts, id=self.ID_ArabicParts)
				self.Bind(wx.EVT_MENU, self.onSyzygy, id=self.ID_Syzygy)
				self.Bind(wx.EVT_MENU, self.onFixStarsOpt, id=self.ID_FixStarsOpt)
				self.Bind(wx.EVT_MENU, self.onProfectionsOpt, id=self.ID_ProfectionsOpt)
# ###########################################
# Roberto change  V 7.3.0
				self.Bind(wx.EVT_MENU, self.onFirdariaOpt, id=self.ID_FirdariaOpt)
# ###########################################
# ###########################################
# Roberto change  V 7.2.0
				self.Bind(wx.EVT_MENU, self.onDefLocationOpt, id=self.ID_DefLocationOpt)
# ###########################################
				self.Bind(wx.EVT_MENU, self.onRevolutionsOpt, id=self.ID_RevolutionsOpt)
				self.Bind(wx.EVT_MENU, self.onQuickChartsOpt, id=self.ID_QuickChartsOpt)
				self.Bind(wx.EVT_MENU, self.onStepAlertsOpt, id=self.ID_StepAlertsOpt)
				self.Bind(wx.EVT_MENU, self.onSetStartupChart, id=self.ID_SetStartupChart)
				self.Bind(wx.EVT_MENU, self.onClearStartupChart, id=self.ID_ClearStartupChart)


				self.Bind(wx.EVT_MENU, self.onLanguages, id=self.ID_Languages)
				self.Bind(wx.EVT_MENU, self.onTriplicities, id=self.ID_Triplicities)
				self.Bind(wx.EVT_MENU, self.onTerms, id=self.ID_Terms)
				self.Bind(wx.EVT_MENU, self.onDecans, id=self.ID_Decans)
				self.Bind(wx.EVT_MENU, self.onChartAlmuten, id=self.ID_ChartAlmuten)
				self.Bind(wx.EVT_MENU, self.onTopicals, id=self.ID_Topical)
				self.Bind(wx.EVT_MENU, self.onAutoSaveOpts, id=self.ID_AutoSaveOpts)
				self.Bind(wx.EVT_MENU, self.onSaveOpts, id=self.ID_SaveOpts)
				self.Bind(wx.EVT_MENU, self.onReload, id=self.ID_Reload)

				self.Bind(wx.EVT_MENU, self.onHelp, id=self.ID_Help)
				self.Bind(wx.EVT_MENU, self.onAbout, id=self.ID_About)
				self.Bind(wx.EVT_MENU, self.onCycleNatalSecondaryRing, id=self.ID_NatalSecondaryCycle)

				self.Bind(wx.EVT_CLOSE, self.onExit)

				self.splash = True

				self.enableMenus(False)
				self.moptions.Enable(self.ID_SaveOpts, True)
				if self.options.checkOptsFiles():
					self.moptions.Enable(self.ID_Reload, True)
				else:
					self.moptions.Enable(self.ID_Reload, False)



				if hasChart:
					self.handleStatusBar(True)
					self.handleCaption(True)
					self.splash = False
					self.enableMenus(True)


				if self.options.autosave:
					if self.options.saveLanguages():
						self.moptions.Enable(self.ID_SaveOpts, True)
#-------------------------------------------------------------------------------

		dlg.Destroy()


	def onTriplicities(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		wx.BeginBusyCursor()
		dlg = triplicitiesdlg.TriplicitiesDlg(self, self.options)
		dlg.CenterOnParent()
		wx.EndBusyCursor()
		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveTriplicities():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.recalcAlmutens()
#					self.drawBkg()
#					self.Refresh()

		dlg.Destroy()


	def onTerms(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		wx.BeginBusyCursor()
		dlg = termsdlg.TermsDlg(self, self.options)
		dlg.CenterOnParent()
		wx.EndBusyCursor()
		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveTerms():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.recalcAlmutens()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onDecans(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		wx.BeginBusyCursor()
		dlg = decansdlg.DecansDlg(self, self.options)
		dlg.CenterOnParent()
		wx.EndBusyCursor()
		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveDecans():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.recalcAlmutens()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onChartAlmuten(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		wx.BeginBusyCursor()
		dlg = almutenchartdlg.AlmutenChartDlg(self)
		dlg.fill(self.options)
		dlg.CenterOnParent()
		wx.EndBusyCursor()
		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveChartAlmuten():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.recalcAlmutens()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onTopicals(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		wx.BeginBusyCursor()
		dlg = almutentopicalsdlg.AlmutenTopicalsDlg(self, self.options)
		dlg.fill(self.options)
		dlg.CenterOnParent()
		wx.EndBusyCursor()
		val = dlg.ShowModal()
		if val == wx.ID_OK:
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveTopicalandParts():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.horoscope.recalcAlmutens()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()

# ###########################################
# Roberto change V 7.3.0
	def onFirdariaOpt(self, event):
		dlg = firdariadlg.FirdariaDlg(self)
		dlg.fill(self.options)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.saveFirdaria():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()

# ###########################################


	def onPrimaryDirsOpt(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		wx.BeginBusyCursor()

		dlg = None
		if self.options.netbook:
			dlg = primarydirsdlgsmall.PrimDirsDlgSmall(self, self.options, common.common.ephepath)
		else:
			dlg = primarydirsdlg.PrimDirsDlg(self, self.options, common.common.ephepath)

		dlg.CenterOnParent()
		wx.EndBusyCursor()
		dlg.fill(self.options)

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			changed, changedU1, changedU2 = dlg.check(self.options)
			if changed or changedU1 or changedU2:
				if changedU1 and not self.splash:
					cpd = None
					if self.options.pdcustomer:
						cpd = customerpd.CustomerPD(self.options.pdcustomerlon[0], self.options.pdcustomerlon[1], self.options.pdcustomerlon[2], self.options.pdcustomerlat[0], self.options.pdcustomerlat[1], self.options.pdcustomerlat[2], self.options.pdcustomersouthern, self.horoscope.place.lat, self.horoscope.houses.ascmc2, self.horoscope.obl[0], self.horoscope.raequasc)
					self.horoscope.setCustomer(cpd)

				if changedU2 and not self.splash:
					cpd2 = None
					if self.options.pdcustomer2:
						cpd2 = customerpd.CustomerPD(self.options.pdcustomer2lon[0], self.options.pdcustomer2lon[1], self.options.pdcustomer2lon[2], self.options.pdcustomer2lat[0], self.options.pdcustomer2lat[1], self.options.pdcustomer2lat[2], self.options.pdcustomer2southern, self.horoscope.place.lat, self.horoscope.houses.ascmc2, self.horoscope.obl[0], self.horoscope.raequasc)
					self.horoscope.setCustomer2(cpd2)

				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.savePrimaryDirs():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onPrimaryKeys(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = primarykeysdlg.PrimaryKeysDlg(self, self.options)
		dlg.CenterOnParent()
		dlg.fill(self.options)

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.savePrimaryKeys():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onPDsInChartOptZod(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = pdsinchartdlgopts.PDsInChartsDlgOpts(self)
		dlg.fill(self.options)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.savePDsInChart():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onPDsInChartOptMun(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = pdsinchartterrdlgopts.PDsInChartsTerrDlgOpts(self)
		dlg.fill(self.options)
		dlg.CenterOnParent()

		val = dlg.ShowModal()
		if val == wx.ID_OK:	
			if dlg.check(self.options):
				self.enableOptMenus(True)

				if self.options.autosave:
					if self.options.savePDsInChart():
						self.moptions.Enable(self.ID_SaveOpts, True)

				if not self.splash:
					self.closeChildWnds()
					self.drawBkg()
					self.Refresh()

		dlg.Destroy()


	def onAutoSaveOpts(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		self.options.autosave = self.autosave.IsChecked()
		if self.options.autosave:
			if self.options.save():
				self.moptions.Enable(self.ID_SaveOpts, True)


	def onSaveOpts(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		if self.options.save():
			self.moptions.Enable(self.ID_SaveOpts, True)


	def onReload(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		dlg = wx.MessageDialog(self, mtexts.txts['AreYouSure'], mtexts.txts['Confirm'], wx.YES_NO|wx.ICON_QUESTION)
		val = dlg.ShowModal()
		if val == wx.ID_YES:
			if self.options.checkOptsFiles():
				self.options.removeOptsFiles()
			self.options.reload()
			common.common.update(self.options)
			self._refresh_workspace_shell_theme()
			self.enableOptMenus(False)
			self.setHouse()
			self.setNode()
			self.setAutoSave()
			if not self.splash:
				self.closeChildWnds()
				self.horoscope.recalc()
				self.drawBkg()
				self.Refresh()


	def onHelp(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		fname = os.path.join('Res', mtexts.helptxt)

		if not os.path.exists(fname):
			txt = fname+' '+mtexts.txts['NotFound']
			dlgm = wx.MessageDialog(self, txt, mtexts.txts['Error'], wx.OK|wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
		else:
			hframe = htmlhelpframe.HtmlHelpFrame(self, -1, mtexts.txts['Morinus'], fname)
			hframe.Show(True)


	def onAbout(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

		info = wx.adv.AboutDialogInfo()
		info.Name = mtexts.txts['Morinus']
		release_version = '10.0.0'
		release_codename = 'Aries'
		info.Version = '%s (%s)' % (release_version, release_codename)
		info.Copyright = mtexts.txts['FreeSoft']
		info.Description = mtexts.txts['Description']+str(astrology.swe_version())
		info.WebSite = 'https://sourceforge.net/p/morinus-updated/'
		info.Developers = ['In alphabetical surname order:\n\nRobert Nagy (Hungary); robert.pluto@gmail.com (programming and astrology)\n\nPhilippe Epaud (France); philipeau@free.fr (French translation)\nMargherita Fiorello (Italy); margherita.fiorello@gmail.com (astrology, Italian translation)\nMartin Gansten (Sweden); http://www.martingansten.com/ (astrology)\nJaime Chica Londoño (Colombia); aulavirtual@astrochart.org (Spanish translation)\nMax Lange (Germany); contact@maxlange.cc (programming and astrology)\nRoberto Luporini (Italy); roberto.luporini@tiscali.it (programming and astrological astronomy)\nElías D. Molins (Spain); elias@biblioteca-astrologia.es (programming and astrology)\nPetr Radek (Czech Rep.); petr_radek@raz-dva.cz (astrology)\nJames Ren (China);541632950@qq.com (programming and astrology, Chinese translation)\nShin Ji-Hyeon (South Korea); shin10567@naver.com (programming and astrology, Korean translation)\nEndre Csaba Simon (Finland); secsaba@gmail.com (programming and astrology)\nVáclav Jan Špirhanzl (Czech Rep.); vjs.morinus@gmail.com (MacOS version)\nDenis Steinhoff (Israel); denis@steindan.com (astrology, Russian translation)']
		info.License = mtexts.licensetxt

		try:
			dlg = wx.adv.GenericAboutDialog(info, self)
			dlg.Layout()
			dlg.Fit()
			fit_w, fit_h = dlg.GetSize()
			disp_w, disp_h = wx.GetDisplaySize()
			max_w = max(560, disp_w - 180)
			max_h = max(420, disp_h - 180)
			dlg.SetSize((min(fit_w, max_w), min(fit_h, max_h)))
			dlg.CenterOnParent()
			dlg.ShowModal()
			dlg.Destroy()
		except Exception:
			wx.adv.AboutBox(info)

	#Misc
	def setHouse(self):
		sysh = (self.itplac, self.itkoch, self.itregio, self.itcampa, self.itequal, self.itwholesign, self.itaxial, self.itmorin, self.ithoriz, self.itpage, self.italcab, self.itporph, self.itnohouses)
		for i in range(len(sysh)):
			if houses.Houses.hsystems[i] == self.options.hsys:
				sysh[i].Check(True)


	def setNode(self):
		if self.options.meannode:
			self.meanitem.Check(True)
		else:
			self.trueitem.Check(True)


	def setAutoSave(self):
		self.autosave.Check(self.options.autosave)


	def closeChildWnds(self):
		li = self.GetChildren()
		for ch in li:
			if ch is getattr(self, '_workspace_shell', None):
				continue
			if ch is self.GetStatusBar():
				continue
			x,y = ch.GetClientSize()
			if ch.GetName() != 'status_line' and y > 50:
				ch.Destroy()

	def refreshOpenWindows(self):
		for win in wx.GetTopLevelWindows():
			if win is self:
				continue
			try:
				if hasattr(win, 'w') and win.w:
					try:
						if hasattr(win.w, 'drawBkg'):
							win.w.drawBkg()
					except Exception:
						pass
					try:
						win.w.Refresh()
					except Exception:
						pass
				elif hasattr(win, 'drawBkg'):
					try:
						win.drawBkg()
					except Exception:
						pass
					try:
						win.Refresh()
					except Exception:
						pass
				else:
					try:
						win.Refresh()
					except Exception:
						pass
			except Exception:
				pass


	def onMenuOpen(self, event):
		if not self.splash:
			self.handleStatusBar(False)


	def onMenuClose(self, event):
		if not self.splash:
			self.handleStatusBar(True)


	def enableMenus(self, bEnable):
		self.mhoros.Enable(self.ID_New, True)
		self.mhoros.Enable(self.ID_Load, True)
		self.mhoros.Enable(self.ID_SetStartupChart, bEnable)
		self.mhoros.Enable(self.ID_ClearStartupChart, True)
		self.mhoros.Enable(self.ID_Data, bEnable)
# ###########################################
# Roberto change  V 7.2.0		
		self.mhoros.Enable(self.ID_HereAndNow, not bEnable)
# ###########################################
		self.mhoros.Enable(self.ID_Save, bEnable)
		self.mhoros.Enable(self.ID_SaveAsBitmap, bEnable)
		self.mhoros.Enable(self.ID_SaveMenu, bEnable)
		self.mhoros.Enable(self.ID_Synastry, bEnable)
		self.mhoros.Enable(self.ID_Close, bEnable)
		self.mtable.Enable(self.ID_Positions, bEnable)
		self.mtable.Enable(self.ID_TAlmutens, bEnable)
		self.mtable.Enable(self.ID_AlmutenZodiacal, bEnable)
		self.mtable.Enable(self.ID_AlmutenChart, bEnable)
		self.mtable.Enable(self.ID_AlmutenTopical, bEnable)
		self.mtable.Enable(self.ID_Misc, bEnable)
		self.mtable.Enable(self.ID_MunPos, bEnable)
		self.mtable.Enable(self.ID_Antiscia, bEnable)
# ###################################
# Elias change v 8.0.0
#		self.mtable.Enable(self.ID_Dodecatemoria, bEnable)
# ###################################    
		self.mtable.Enable(self.ID_Aspects, bEnable)
		self.mtable.Enable(self.ID_FixStars, bEnable)
		self.mtable.Enable(self.ID_FixStarsAsps, bEnable)
		self.mtable.Enable(self.ID_Midpoints, bEnable)
		self.mtable.Enable(self.ID_RiseSet, bEnable)
		self.mtable.Enable(self.ID_Speeds, bEnable)
		self.mtable.Enable(self.ID_ZodPars, bEnable)
		self.mtable.Enable(self.ID_Arabians, bEnable)
		self.mtable.Enable(self.ID_Strip, bEnable)
		self.mtable.Enable(self.ID_PlanetaryHours, bEnable)
		self.mtable.Enable(self.ID_ExactTransits, bEnable)
		self.mtable.Enable(self.ID_SearchModule, bEnable)
		self.mtable.Enable(self.ID_Profections, bEnable)
		self.mtable.Enable(self.ID_CustomerSpeculum, bEnable)
# ###########################################
# Roberto change  V 7.3.0		
		self.mtable.Enable(self.ID_Firdaria, bEnable)
# ###########################################		
# ###################################
# Roberto change v 8.0.1
		self.mtable.Enable(self.ID_Dodecatemoria, bEnable)
		self.mtable.Enable(self.ID_AngleAtBirth, bEnable)
		self.mtable.Enable(self.ID_PrimaryDirs, bEnable)
		self.mtable.Enable(self.ID_ZodiacalReleasing, bEnable)
		self.mtable.Enable(self.ID_Phasis, bEnable)
		self.mtable.Enable(self.ID_Paranatellonta, bEnable)
		self.mtable.Enable(self.ID_Circumambulation, bEnable)
		self.mtable.Enable(self.ID_FixStarAngleDirs, bEnable)
		self.mtable.Enable(self.ID_Eclipses, bEnable)
		self.mcharts.Enable(self.ID_Transits, bEnable)
		self.mcharts.Enable(self.ID_Revolutions, bEnable)
		self.mcharts.Enable(self.ID_SunTransits, bEnable)
		self.mcharts.Enable(self.ID_SecProgMenu, bEnable)
		self.mcharts.Enable(self.ID_ChartsMenu, bEnable)
		self.mcharts.Enable(self.ID_SecProgChart, bEnable)
		self.mcharts.Enable(self.ID_SecProgPositions, bEnable)
		self.mcharts.Enable(self.ID_Elections, bEnable)
		self.mcharts.Enable(self.ID_SquareChart, bEnable)
		self.mcharts.Enable(self.ID_ProfectionsChart, bEnable)
		self.mcharts.Enable(self.ID_MundaneChart, bEnable)
		# --- NEW: disable/enable newly added grouped submenus when no chart is open ---
		# Tables (group headers)
		for _mid in (
			getattr(self, 'ID_PlanetsPointsMenu', None),
			getattr(self, 'ID_FixedStarsMenu',   None),
			getattr(self, 'ID_TimeLordsMenu',    None),
			getattr(self, 'ID_PrimaryDirsMenu',  None),
			getattr(self, 'ID_ChartsMenu',  None),
			getattr(self, 'ID_PlanetsPointsoptMenu',  None),
		):
			try:
				if _mid is not None:
					self.mtable.Enable(_mid, bEnable)
			except Exception:
				# In case the submenu wasn't built in this build variant
				pass

		# Charts (group header)
		try:
			self.mcharts.Enable(self.ID_TransitsMenu, bEnable)
		except Exception:
			pass


	def enableOptMenus(self, bEnable):
		self.moptions.Enable(self.ID_SaveOpts, bEnable)
		self.moptions.Enable(self.ID_Reload, bEnable)


	def _apply_statusbar_colours(self):
		sb = self.GetStatusBar()
		if sb is None:
			return
		bg = wx.SystemSettings.GetColour(wx.SYS_COLOUR_MENUBAR)
		fg = wx.SystemSettings.GetColour(wx.SYS_COLOUR_MENUTEXT)
		sb.SetBackgroundColour(bg)
		sb.SetForegroundColour(fg)
		sb.Refresh()

	def onFrameActivate(self, event):
		self._apply_statusbar_colours()
		event.Skip()

	def onFrameSize(self, event):
		self._apply_statusbar_colours()
		event.Skip()

	def handleStatusBar(self, bHor):
		sb = self.GetStatusBar()
		if sb is None:
			sb = self.CreateStatusBar(name='status_line')
		if bHor:
			sb.SetFieldsCount(4)
			sb.SetStatusWidths([160, 80, 220, 220])
			txt = self.horoscope.name
			if self.horoscope.name == '':
				txt = mtexts.txts['Untitled']
			self.SetStatusText(txt, 0)
			self.SetStatusText(mtexts.typeList[self.horoscope.htype], 1)
			signtxt = ''
			if self.horoscope.time.bc:
				signtxt = '-'
			ztxt = mtexts.txts['UT']
			if self.horoscope.time.zt == chart.Time.ZONE:
				ztxt = mtexts.txts['ZN']
			if self.horoscope.time.zt == chart.Time.LOCALMEAN or self.horoscope.time.zt == chart.Time.LOCALAPPARENT:
				ztxt = mtexts.txts['LC']
			txt = signtxt+str(self.horoscope.time.origyear)+'.'+common.common.months[self.horoscope.time.origmonth-1]+'.'+(str(self.horoscope.time.origday)).zfill(2)+', '+(str(self.horoscope.time.hour)).zfill(2)+':'+(str(self.horoscope.time.minute)).zfill(2)+':'+(str(self.horoscope.time.second)).zfill(2)+ztxt
			cs = self._active_chart_session()
			secondary_info = self._format_secondary_real_date_and_age(cs)
			if secondary_info is not None:
				date_txt, age_years = secondary_info
				txt = '%s, Age: %.2fy' % (date_txt, age_years)
			pd_info = self._format_pd_date_and_age(cs)
			if pd_info is not None and secondary_info is None:
				date_txt, age_years = pd_info
				txt = '%s, Age: %.2fy' % (date_txt, age_years)
			prof_info = self._format_profection_real_date_and_age(cs)
			if prof_info is not None and secondary_info is None and pd_info is None:
				date_txt, age_years = prof_info
				txt = '%s, Age: %.2fy' % (date_txt, age_years)
			solar_info = self._format_solar_real_date_and_age(cs)
			if solar_info is not None and secondary_info is None and pd_info is None and prof_info is None:
				date_txt, age_years = solar_info
				txt = '%s, Age: %.2fy' % (date_txt, age_years)
			lunar_info = self._format_lunar_real_date_and_age(cs)
			if lunar_info is not None and secondary_info is None and pd_info is None and prof_info is None and solar_info is None:
				date_txt, age_years = lunar_info
				txt = '%s, Age: %.2fy' % (date_txt, age_years)
			self.SetStatusText(txt, 2)
			deg_symbol = u'°'
			t1 = mtexts.txts['Long']+': '
			t2 = ', '+mtexts.txts['Lat']+': '
			dirlontxt = mtexts.txts['E']
			if not self.horoscope.place.east:
				dirlontxt = mtexts.txts['W']
			dirlattxt = mtexts.txts['N']
			if not self.horoscope.place.north:
				dirlattxt = mtexts.txts['S']

			txt = t1+(str(self.horoscope.place.deglon)).zfill(2)+deg_symbol+(str(self.horoscope.place.minlon)).zfill(2)+"'"+dirlontxt+t2+(str(self.horoscope.place.deglat)).zfill(2)+deg_symbol+(str(self.horoscope.place.minlat)).zfill(2)+"'"+dirlattxt
			self.SetStatusText(txt, 3)
		else:
			sb.SetFieldsCount(1)
			self.SetStatusText('')

		self._apply_statusbar_colours()


	def handleCaption(self, bHor):
		if bHor:
			name = self.horoscope.name
			if name == '':
				name = mtexts.txts['Untitled']
			path = self.fpath
			if self.fpath == '':
				path = '-----'
				cs = self._active_chart_session()
				secondary_info = self._format_secondary_real_date_and_age(cs)
				if secondary_info is not None:
					date_txt, age_years = secondary_info
					path = '%s, Age: %.2fy' % (date_txt, age_years)
				if secondary_info is None:
					prof_info = self._format_profection_real_date_and_age(cs)
					if prof_info is not None:
						date_txt, age_years = prof_info
						path = '%s, Age: %.2fy' % (date_txt, age_years)
					if prof_info is None:
						solar_info = self._format_solar_real_date_and_age(cs)
						if solar_info is not None:
							date_txt, age_years = solar_info
							path = '%s, Age: %.2fy' % (date_txt, age_years)
						if solar_info is None:
							lunar_info = self._format_lunar_real_date_and_age(cs)
							if lunar_info is not None:
								date_txt, age_years = lunar_info
								path = '%s, Age: %.2fy' % (date_txt, age_years)

			txt = self.origtitle+' - '+'['+name+', '+mtexts.typeList[self.horoscope.htype]+'; '+path+']'
			self.title = txt
		else:
			self.title = self.origtitle

		self.SetTitle(self.title)


	def checkFixStars(self):
		res = True

		# 고정별 카탈로그 탐색 우선순위:
		# 1) <ephepath>\sefstars.txt
		# 2) <ephepath>\SWEP\Ephem\sefstars.txt
		# 3) <ephepath>\fixstars.cat
		# 4) <ephepath>\fixedstars.cat
		# 5) <ephepath>\SWEP\Ephem\fixstars.cat
		# 6) <ephepath>\SWEP\Ephem\fixedstars.cat
		base = common.common.ephepath
		p0 = os.path.join(base, 'sefstars.txt')
		p1 = os.path.join(base, 'fixstars.cat')
		p2 = os.path.join(base, 'fixedstars.cat')
		p3 = os.path.join(base, 'SWEP', 'Ephem', 'sefstars.txt')
		p4 = os.path.join(base, 'SWEP', 'Ephem', 'fixstars.cat')
		p5 = os.path.join(base, 'SWEP', 'Ephem', 'fixedstars.cat')

		if   os.path.exists(p0): fname = p0
		elif os.path.exists(p3): fname = p3
		elif os.path.exists(p1): fname = p1
		elif os.path.exists(p2): fname = p2
		elif os.path.exists(p4): fname = p4
		elif os.path.exists(p5): fname = p5
		else:
			# 아무것도 못 찾았을 때: 시도한 경로들을 안내
			tried = [p0, p3, p1, p2, p4, p5]
			txt = (mtexts.txts.get('NotFound', 'Not found') + u':\n' +
				   u'\n'.join(tried))
			dlgm = wx.MessageDialog(self, txt, mtexts.txts.get('Error','Error'),
									wx.OK | wx.ICON_INFORMATION)
			dlgm.ShowModal()
			dlgm.Destroy()
			res = False
		# --- [ADD] 선호이름 JSON을 옵션에 로드(세션 시작 시 복구) ---
		try:
			if not hasattr(self.options, 'fixstarAliasMap') or not isinstance(self.options.fixstarAliasMap, dict):
				self.options.fixstarAliasMap = {}
			alias_json = os.path.join(base, 'fixstar_aliases.json')
			if os.path.isfile(alias_json):
				import json as _json
				with open(alias_json, 'r') as _f:
					_data = _json.load(_f)
				if isinstance(_data, dict):
					self.options.fixstarAliasMap.update({k: v for k, v in _data.items() if isinstance(k, str)})
		except Exception:
			pass
		# -------------------------------------------------------------------

		return res


	def drawSplash(self):
		splashpath = os.path.join('Res', 'Morinus.jpg')
		try:
			img = wx.Image(splashpath)
			if not img.IsOk():
				raise RuntimeError('bad image')
			photo = img.ConvertToBitmap()
			desc = mtexts.txts['Description'] + str(astrology.swe_version())
			info = [mtexts.txts['FreeSoft']] + [l.strip() for l in desc.split('\n')]
			if hasattr(self, '_workspace_shell') and self._workspace_shell is not None:
				self._workspace_shell.set_chart_splash(
					photo, 'ARIES', 'Morinus 10.0.0', info)
			else:
				self.buffer = photo
				self._push_chart_bitmap(photo, center=True)
			return
		except Exception:
			pass
		self._push_chart_bitmap(wx.Bitmap(1, 1), center=True)


	def drawBkg(self):
		# On macOS wx is strict about int coords; chart rendering can throw while we
		# modernize drawing code. Prefer the selected theme but fall back to the
		# other renderer so the user still gets a visible chart.
		renderers = []
		if self.options.theme == 0:
			renderers = [("GraphChart", graphchart.GraphChart), ("GraphChart2", graphchart2.GraphChart2)]
		else:
			renderers = [("GraphChart2", graphchart2.GraphChart2), ("GraphChart", graphchart.GraphChart)]

		cs = self._active_chart_session()
		compound_base = None
		compound_overlay = None
		if cs and cs.view_mode == chart_session.ChartSession.COMPOUND:
			compound_base = cs.radix
			compound_overlay = self.horoscope
		if compound_base is None and cs is not None:
			active_id = self._workspace_state.active_document_id()
			active_session = self._find_workspace_session(active_id)
			if active_session is not None and active_session.get('parallel_transits_enabled'):
				dt = getattr(cs, 'display_datetime', None)
				if dt is not None:
					try:
						y, m, d, h, mi, s = dt
						radix = cs.radix if cs.radix is not None else cs.chart
						place = radix.place
						transit_time = chart.Time(
							int(y), int(m), int(d), int(h), int(mi), int(s),
							False, radix.time.cal, radix.time.zt,
							radix.time.plus, radix.time.zh, radix.time.zm,
							False, place, False,
							tzid=getattr(radix.time, 'tzid', ''),
							tzauto=getattr(radix.time, 'tzauto', False),
						)
						transit_chart = chart.Chart(
							radix.name, radix.male, transit_time, place,
							chart.Chart.TRANSIT, '', self.options, False,
						)
						compound_base = cs.chart
						compound_overlay = transit_chart
					except Exception:
						pass
		for name, cls in renderers:
			try:
				if compound_base is not None:
					gchart = cls(compound_base, self._render_target_size(), self.options, self.options.bw, chrt2=compound_overlay)
				else:
					gchart = cls(self.horoscope, self._render_target_size(), self.options, self.options.bw)
				try:
					if cs is not None:
						gchart.radix = cs.radix
						gchart.display_datetime = getattr(cs, 'display_datetime', None)
				except Exception:
					pass
				self._push_chart_bitmap(gchart.drawChart())
				return
			except Exception:
				try:
					import traceback
					print("drawBkg renderer failed:", name)
					traceback.print_exc()
				except Exception:
					pass


	def onEraseBackground(self, event):
		dc = wx.ClientDC(self)
#		dc = event.GetDC()
		x = y = 0

		if getattr(self, "buffer", None) is None:
			try:
				self.drawSplash()
			except Exception:
				return

		# If splash loading failed for any reason, skip drawing instead of crashing.
		if getattr(self, "buffer", None) is None:
			return

		if self.splash:
			wx.size = self.GetClientSize()
			x = int((wx.size.x - self.buffer.GetWidth()) // 2)
			y = int((wx.size.y - self.buffer.GetHeight()) // 2)

			bkgclr = self.options.clrbackground
			if self.options.bw:
				bkgclr = (255,255,255)
			self.SetBackgroundColour(bkgclr)
			self.ClearBackground()

		dc.DrawBitmap(self.buffer, x, y)


	def onPaint(self, event):
		dc = wx.PaintDC(self)
		x = y = 0

		if getattr(self, "buffer", None) is None:
			try:
				self.drawSplash()
			except Exception:
				return

		# If splash loading failed for any reason, skip drawing instead of crashing.
		if getattr(self, "buffer", None) is None:
			return

		if self.splash:
			wx.size = self.GetClientSize()
			x = int((wx.size.x - self.buffer.GetWidth()) // 2)
			y = int((wx.size.y - self.buffer.GetHeight()) // 2)

			bkgclr = self.options.clrbackground
			if self.options.bw:
				bkgclr = (255,255,255)
			self.SetBackgroundColour(bkgclr)

		dc.DrawBitmap(self.buffer, x, y)


	def onSize(self, event):
		self._handle_chart_host_resize()
		if event is not None:
			event.Skip()


	def calc(self):
		for planet in self.horoscope.planets.planets:
			print ('')
			print ('%s:' % planet.name)

			(d, m, s) = decToDeg(planet.data[0])
			print ('lon: %02d %02d\' %02d"' % (d, m, s))
			(d, m, s) = decToDeg(planet.data[1])
			print ('lat: %02d %02d\' %02d"' % (d, m, s))
			(d, m, s) = decToDeg(planet.data[3])
			if planet.data[3] > 0:
				print ('speed: %02d %02d\' %02d"' % (d, m, s))
			else:
				print ('speed: %02d %02d\' %02d"  R' % (d, m, s))


		print ('')
		print ('Houses')
		for i in range(1, Houses.HOUSE_NUM+1):
			(d, m, s) = decToDeg(self.horoscope.houses.cusps[i])
			print ('house[%d]: %02d %02d\' %02d"' % (i, d, m, s))

		print ('')
		print ('Vars')
		xvars = ('Asc', 'MC', 'ARMC', 'Vertex', 'Equatorial Ascendant', 'Co-Asc', 'Co-Asc2', 'Polar Asc')
		for i in range(0, 8):
			(d, m, s) = decToDeg(self.horoscope.houses.ascmc[i])
			print ('%s = %02d %02d\' %02d"' % (xvars[i], d, m, s))


#import swisseph as swe
from sweastrology import *
def _get_obliquity_deg(jd_ut):
	# mean obliquity
	return swe.obl_ecl(jd_ut)[0]  # degrees

def lot_declination_deg(lon_ecl_deg, jd_ut, beta_ecl_deg=0.0):
	"""

	"""
	eps = _get_obliquity_deg(jd_ut)
	# swe.cotrans((lon, lat, dist), eps) -> (RA, Dec, dist) in degrees
	ra_deg, dec_deg, _ = swe.cotrans((lon_ecl_deg, beta_ecl_deg, 1.0), eps)
	return dec_deg

def fmt_decl_deg(x):
	
	sign = u'+' if x >= 0 else u'−'
	ax = abs(x)
	d = int(ax)
	m = int((ax - d) * 60)
	s = int(round(((ax - d) * 60 - m) * 60))
	
	if s == 60:
		s = 0; m += 1
	if m == 60:
		m = 0; d += 1
	return u"%s%02d°%02d′%02d″" % (sign, d, m, s)






